const child_process = require("child_process");

const cassandra_container = 'cassandra'
const deepstream_keyspace = 'deepstream'

const findDockerContainerIPAddress = (name=cassandra_container) => {
  return new Promise((resolve, reject) => {
    child_process.exec(
      `docker inspect -f '\''{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'\'' ${name}`,
      (err, stdout, stderr) => {
        if (err)
          return reject(err)
        const host = stdout.replace(/[\n\t\r]/g,'')
        if (host.length < 1)
          return reject('Cassandra container has no ip address (is it running?)')
        resolve(host)
      })
  })  
}


module.exports.getSettings = () => {
  return new Promise((resolve, reject) => {
    const keyspace = process.env.DEEPSTREAM_KEYSPACE || deepstream_keyspace
    let db_hosts = [ process.env.CASSANDRA_HOST ]
    if (db_hosts[0] === undefined) {
      findDockerContainerIPAddress(process.env.CASSANDRA_DOCKER || cassandra_container)
        .then(host => {
          resolve( {
            keyspace: keyspace,
            db_hosts: [ host ]
          })
        })
        .catch(err => {
          reject(err)
        })
    } else {
      return resolve( {
        keyspace: keyspace,
        db_hosts: db_hosts
      })
    }
  })
}
