# deepstream.io-storage-cassandra

[deepstream](https://deepstream.io) storage connector for [Apache Cassandra](http://cassandra.apache.org)

Code status: ALPHA prototype - I have not really tested this other than to see the unit tests pass. Caveat emptor.

## Configuration options
```yaml
plugins:
  storage:
    name: cassandra
    options:
      db_hosts:
        - ${CASSANDRA_HOST}
      keyspace: 'deepstream' # This keyspace has to already exist

      # optional (specify only if you want different defaults)
      defaultTable: 'global'
      defaultPrimaryKey:
        - name: 'pk'
          type: 'text'
        - name: 'k1'
          type: 'text'
        - name: 'k2'
          type: 'text'
        - name: 'k3'
          type: 'text'
```

 * db_hosts - The initial list of Cassandra nodes for the driver to connect to
 * keyspace - The Cassandra keyspace for deepstream to manage
 * defaultTable - The default table to store records that don't specify a table name
 * createTableClusterKeys - The default key columns to create on new
   tables. The default is to use all text fields. You can specify
   non-text fields if you wish, but you will have to do extra frontend
   validation in valve to prevent using invalid keys in this case.

## How records are mapped to Cassandra rows:

This connector decomposes the deepstream record key into a composite
key with [clustering
columns](http://cassandra.apache.org/doc/latest/cql/ddl.html#clustering-columns). This is the format:

```{table_name}/{partition_key}/{optional_1st_cluster_key}/.../{optional_nth_cluster_key}```

For example, a deepstream record might look like this:

 * key: 'user/ryan/settings'
 * data: ```{ defaultView: 'messages', allowMessages: ['admin', 'mod']}```

Cassandra would store such a record this way (assuming defaultPrimaryKey hasn't been modified):

 * ```CREATE TABLE IF NOT EXISTS user (pk text, k1 text, k2 text, k3 text, data text, PRIMARY KEY (pk, k1, k2, k3));```
 * ```INSERT INTO user JSON '{ pk:"ryan", k1:"settings", k2:"", k3:"", data: /*serialized data here*/ }'```

k1, k2, and k3 are the clustering columns. A deepstream record key
does not need to specify all of the cluster keys, but those that it
omits will be set to a blank string '' (as is the case here with k2
and k3.) If a record key specifies *more* cluster keys than exist on
the table, they will spill over into the last cluster column. For
instance, the key 'user/ryan/one/two/three/four' would look like this
in cassandra, note k3, the last key column, is allowed to have '/' in
it:

     pk   | k1  | k2  | k3         | data
    ------+-----+-----+------------+------------------
     ryan | one | two | three/four | /* serialized data */


The client really does not need to worry about these details, but it
is useful to understand how the data is stored so that you can make
efficient queries. [See more examples in the the connector code
here](src/connector.js)

