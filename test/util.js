const child_process = require("child_process");

const cassandra_container = 'server_cassandra_1'
const deepstream_keyspace = 'deepstream'


//This is is used by the docker *host* to run tests
//This won't work from inside one of the containers.
module.exports.getSettings = () => {
  return new Promise((resolve, reject) => {
    const settings = {
      keyspace: deepstream_keyspace
    }
    //Get cassandra hostname
    child_process.exec(
      `docker inspect -f '\''{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'\'' ${cassandra_container}`,
      (err, stdout, stderr) => {
        if (err)
          return reject(err)
        const host = stdout.replace(/[\n\t\r]/g,'')
        if (host.length < 1)
          return reject('Cassandra container has no ip address (is it running?)')
        settings.db_hosts = [host]
        resolve(settings)
      })
  })
}
