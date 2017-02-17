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
      keyspace: 'deepstream'
      defaultTable: 'global'
      createTableClusterKeys: 3
```

 * db_hosts - The initial list of Cassandra nodes for the driver to connect to
 * keyspace - The Cassandra keyspace for deepstream to manage
 * defaultTable - The default table to store records that don't specify a table name
 * createTableClusterKeys - The number of clustering keys to create on new tables.


## How records are mapped to Cassandra rows:

This connector decomposes the deepstream record key into a composite
key with [clustering
columns](http://cassandra.apache.org/doc/latest/cql/ddl.html#clustering-columns). This is the format:

```{table_name}/{partition_key}/{optional_1st_cluster_key}/.../{optional_nth_cluster_key}```

For example, a deepstream record might look like this:

 * key: 'user/ryan/settings'
 * data: ```{ defaultView: 'messages', allowMessages: ['admin', 'mod']}```

Cassandra would store such a record this way (assuming createTableClusterKeys=3):

 * ```CREATE TABLE IF NOT EXISTS user (pk text, k1 text, k2 text, k3 text, data text, PRIMARY KEY (pk, k1, k2, k3));```
 * ```INSERT INTO user JSON '{ pk:"ryan", k1:"settings", k2:"", k3:"", data: /*serialized data here*/ }'```

k1, k2, and k3 are the clustering columns. A deepstream record key
does not need to specify all of the cluster keys, but those that it
omits will be set to a blank string '' (as is the case here with k2
and k3.)

The client really does not need to worry about this detail, but it is
useful on the backend for storing records in an ordered fashion making
for efficient queries. [See more examples in the the connector code
here](src/connector.js)

You will want to tighten up your valve permissions to not be able to
create records that have more cluster keys than you have specified in
createTableClusterKeys. For instance, if createTableClusterKeys=3,
then the key 'user/ryan/one/two/three/four' would produce an error
when attempting to save, because the table cannot store more than
three cluster keys in this case.
