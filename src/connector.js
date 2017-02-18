'use strict'

const events = require( 'events' )
const util = require( 'util' )
const cassandra = require('cassandra-driver')
const _ = require('lodash')
const pckg = require( '../package.json' )

/**
 * Cassandra deepstream storage connector
 * 
 * Keys follow this format:
 *  {table_name}/{partition_key}/{optional_1st_cluster_key}/.../{optional_nth_cluster_key}
 *
 * Any omitted cluster keys are replaced with an empty string. Giving
 * a default to each cluster key this way ensures only a single record
 * is returned. Keys specified with more cluster keys than is defined
 * on the table will overflows them into the last cluster column (see
 * example below.) Requesting a key for a table that does not exist
 * will silently create the table first. 
 *
 * Automatic table creation uses a DDL like this by default:
 *  CREATE TABLE test (pk text, k1 text, k2 text, 
 *    k3 text, data text, PRIMARY KEY (pk, k1, k2, k3));
 *
 * You can also use other column types for your cluster keys. You can do this two ways:
 *   1) Modifying the colSpec in options.defaultPrimaryKey
 *   2) Calling createTable(name, colSpec) directly.
 * A colspec could look like this:
 *   eg: [{name:'pk', type:'uuid'}, {name: 'attr', type:'int'}]
 * This would create a table like this:
 *   CREATE TABLE test (pk uuid, attr int, data text, PRIMARY KEY (pk, attr));
 * NOTE: if you use non-text values for keys, you will need to do
 *   extra validation in valve to ensure that the keys you create are
 *   valid for your schema, otherwise you'll get errors on save. 
 *
 * Most other storage connectors use everything after the table_name as a
 * single key field. However, in Cassandra we can use a composite key
 * (pk, k1, k2, k3) and do more effective query operations later.
 *
 * Example keys:
 *  ryan - A parentless global object called 'ryan' that lives in the default table (options.defaultTable)
 *  user/ryan - A record for the user called ryan in the user table (pk='ryan' k1='' k2='' k3='')
 *  user/ryan/settings - Ryan's main settings (pk='ryan' k1='settings' k2='' k3='')
 *  user/ryan/settings/app2 - Ryan's settings for app2 (pk='ryan' k1='settings' k2='app2' k3='')
 *  user/ryan/inbox - Ryan's inbox (pk='ryan' k1='inbox' k2='' k3='')
 *  user/ryan/inbox/message/xxxxx - A specific message in Ryan's inbox (pk='ryan' k1='inbox' k2='message' k3='xxxxx')
 *  user/ryan/some/more/really/really/deep/thing - A record that overflows the cluster columns:
 *                                                 (pk:'ryan' k1:'some' k2:'more' k3:'really/really/deep/thing')
 *
 * As long as you order your cluster keys wisely, you can enable efficient queries for other clients:
 *  - Get Ryan's main inbox object, always returns one row:
 *    - SELECT * FROM user WHERE pk='ryan' AND k1='inbox' AND k2='' and k3=''
 *  - Get all of Ryan's inbox messages, (note k3 is unspecified to return all values):
 *    - SELECT * FROM user WHERE pk='ryan' AND k1='inbox' AND k2='message'
 *  - Delete the entire ryan account and all its data:
 *    - DELETE FROM user WHERE pk='ryan'
 *  - Query deep keys, but still only possible to query on the exact cluster columns:
 *    - SELECT * FROM user WHERE pk='ryan' AND k1='some' AND k2='more' AND k3='really/really/deep/thing'
 *      (If you wanted to query just on the first 'really', you would need more cluster columns defined)
 */
class Connector extends events.EventEmitter {

  /* @param {Object} options Any options the connector needs to connect to the cache/db and to configure it.
  *
  * @constructor
  */
  constructor( options ) {
    super()
    this.isReady = false
    this.name = pckg.name
    this.version = pckg.version
    this._keyspace = options.keyspace
    this._defaultTable = options.defaultTable || 'global'
    this._defaultPrimaryKey = options.defaultPrimaryKey || [{name:'pk', type:'text'},
                                                            {name:'k1', type:'text'},
                                                            {name:'k2', type:'text'},
                                                            {name:'k3', type:'text'}]
    this._tablemeta = {}
    
    this.client = new cassandra.Client({ contactPoints: options.db_hosts, keyspace: options.keyspace })
    console.log(`Connecting to cassandra host ${options.db_hosts} ...`)
    this.client.connect().then( () => {
      console.log("Connected to cassandra")
      this.isReady = true
      this.emit('ready')
    }).catch((err) => {
      console.error(err)
      this.emit('error', 'connection failed')
      this.close()
    })
  }

  /**
  * Writes a value to the connector.
  *
  * @param {String}   key
  * @param {Object}   value
  * @param {Function} [callback] Should be called with null for successful set operations or with an error message string
  *
  * @private
  * @returns {void|Promise} if callback is provided, this returns nothing. Otherwise a Promise is returned.
  */
  set( key, value, callback ) {
    const p = new Promise((resolve, reject) => {
      const cb = callback || function(err) {
        if (err) {
          console.log(err)
          reject(err)
        }
        else resolve()
      }
      this._validateKeyAndValue(key, value).then(validated => {
        const json = JSON.stringify(_.assign({}, validated.keys, {data: JSON.stringify(validated.data)}))
        const query = `INSERT INTO ${validated.table} JSON ?`
        this.client.execute(query, [json], {prepare: true})
            .then(result => cb(null))
            .catch(err => cb(err))
      }).catch((err) => {
        cb(err)
      })
    })
    if (callback === undefined)
      return p
  }

  /**
  * Retrieves a value from the connector.
  *
  * @param {String}   key
  * @param {Function} [callback] Will be called with null and the stored object
  *                            for successful operations or with an error message string
  *
  * @returns {void|Promise} if callback is provided, this returns nothing. Otherwise a Promise is returned.
  */
  get( key, callback ) {
    const p = new Promise((resolve, reject) => {
      const cb = callback || function(err, value) {
        if (err) {
          console.log(err)
          reject(err)
        }
        else resolve(value)
      }
      this._validateKeyAndValue(key).then(validated => {
        const keyConstraints = Object.keys(validated.keys).map(k => {
          return `${k}=?`
        })
        const query = `SELECT JSON * from ${validated.table} WHERE ${keyConstraints.join(' AND ')}`
        this.client.execute(query, validated.keys, {prepare: true})
               .then(result => {
                 if (result.rowLength == 0) {
                   //No record found
                   return cb(null, null)
                 } else if (result.rowLength > 1) {
                   return cb(`More than one record found for key: ${key}`)
                 } else {
                   //Deserialize data:
                   const record = JSON.parse(result.rows[0]['[json]'])
                   record.data = JSON.parse(record.data)
                   cb(null, record.data)
                 }
               })
               .catch(err => cb(err))
      }).catch((err) => {
        cb(err)
      })
    })
    if (callback === undefined)
      return p
  }

  /**
  * Deletes an entry from the connector.
  *
  * @param   {String}   key
  * @param   {Function} [callback] Will be called with null for successful deletions or with
  *                     an error message string
  *
  * @returns {void|Promise} if callback is provided, this returns nothing. Otherwise a Promise is returned.
  */
  delete( key, callback ) {
    const p = new Promise((resolve, reject) => {
      const cb = callback || function(err) {
        if (err) {
          console.log(err)
          reject(err)
        }
        else resolve()
      }
      this._validateKeyAndValue(key).then(validated => {
        const keyConstraints = Object.keys(validated.keys).map(k => {
          return `${k}=?`
        })
        const query = `DELETE FROM ${validated.table} WHERE ${keyConstraints.join(' AND ')}`
        this.client.execute(query, validated.keys, {prepare: true})
            .then(result => {
              cb(null)
            }).catch(err => {
              cb(err)
            })
      }).catch((err) => {
        cb(err)
      })
    })
    if (callback === undefined)
      return p
  }

  /**
   * Gracefully close the connector and any dependencies.
   *
   * Called when deepstream.close() is invoked.
   * If this method is defined, it must emit 'close' event to notify deepstream of clean closure.
   *
   * (optional)
   *
   * @public
   * @returns {void}
   */
  close() {
    console.log("Connector shutting down ...")
    this.client.shutdown()
           .then(() => {
             this.emit('close')
           })
  }

  /**
   * Retrieve table metadata and cache it
   *
   * Creates table if necessary
   *
   * @param   {String}   tableName the name of the table to get metadata
   *
   * @returns {Promise}  .then(metadata) and .catch(err)
   */  
  _getTableMeta( tableName ) {
    return new Promise((resolve, reject) => {
      if (this._tablemeta[tableName]) {
        return resolve(this._tablemeta[tableName])
      } else {
        this.client.metadata.getTable(this._keyspace, tableName).then((tableMeta) => {
          if (tableMeta) {
            this._tablemeta[tableName] = {
              partitionKey: {name: tableMeta.partitionKeys[0].name,
                             type: cassandra.types.getDataTypeNameByCode(tableMeta.partitionKeys[0].type)},
              clusteringKeys: tableMeta.clusteringKeys.map(key => {
                return {name: key.name,
                        type: cassandra.types.getDataTypeNameByCode(key.type)}
              })
            }
            return resolve(this._tablemeta[tableName])
          } else {
            // Create table
            this.createTable(tableName, this._defaultPrimaryKey)
                .then(result => {
                  this._tablemeta[tableName] = result
                  return resolve(result)
                }).catch(err => {
                  console.log(err)
                  reject(err)
                })
          }
        }).catch(err => {
          console.log(err)
          reject(err)
        })
      } 
    })
  }

  /**
   * Create a table and return some metadata about it:
   */
  createTable( tableName, keyColumns ) {
    return new Promise((resolve, reject) => {
      const keyCols = keyColumns.map(col => {
        return `${col.name} ${col.type}`
      }).join(', ')
      const primaryKey = keyColumns.map(col => {
        return `${col.name}`
      }).join(', ')
      const query = `CREATE TABLE IF NOT EXISTS ${tableName} (${keyCols}, data text, PRIMARY KEY (${primaryKey}))`
      this.client.execute(query)
          .then(result => {
            return resolve({
              partitionKey: keyColumns[0],
              clusteringKeys: keyColumns.slice(1)
            })
          })
    })
  }
  
  /**
   * Determines the table, partition, and cluster keys to use based on the provided key
   * 
   * Returns a Promise containing the validated table name and record object.
   */
  
  _validateKeyAndValue( key, value ) {
    return new Promise((resolve, reject) => {
      const pattern = /^[a-zA-Z0-9\-_]+(\/[a-zA-Z0-9\-_]+)*$/
      if (!pattern.test(key))
        return reject(`Key (${key}) has invalid format (must be alpha-numeric + hyphens + underscores)`)
      
      const keyParts = key.split('/')
      if (keyParts.length === 1)
        //Redirect keys without a table to global table
        keyParts.unshift(this._defaultTable) 
      
      //The table name specified:
      const tableName = keyParts[0]
      //The partition key specified:
      const partitionKey = keyParts[1]
      //The clustering keys specified:
      let clusterKeys = keyParts.slice(2)
      
      this._getTableMeta( tableName ).then((metadata) => {
        //The partition key defined by the table:
        const partitionKeyName = metadata.partitionKey.name
        //The clustering keys defined by the table:
        const clusterKeyNames = metadata.clusteringKeys.map(col => col.name)
        if (clusterKeyNames.length < clusterKeys.length ) {
          //The key has more parts to it than we have cluster columns in the table.
          //Let the cluster keys that overflow spill into the last key column as one key with / in it.
          // eg. /user/ryan/one/two/three/four becomes pk='ryan' k1='one' k2='two' k3='three/four'
          const k = clusterKeyNames.length - 1
          clusterKeys = clusterKeys.slice(0,k).concat(clusterKeys.slice(k).join('/'))
        }
        //The key values:
        const keys = {}
        keys[partitionKeyName] = partitionKey
        metadata.clusteringKeys.map((k, i) => {
          keys[k.name] = _.get(clusterKeys, i, '') //Blank is default value for non-specified keys
        })
        //The validated key names and their passed in values:
        return resolve({table: tableName, keys: keys, data: value})
      }).catch((err) => {
        console.error(err)
        return reject(`Failed to retrieve table metadata for ${tableName}: ${JSON.stringify(err)}`)
      })
    })
  }
}

module.exports = Connector
