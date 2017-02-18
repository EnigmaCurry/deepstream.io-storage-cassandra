const Connector = require('./connector')
const util = require('./util')

const testConnector = (conn) => {
  conn.set('user/ryan/one/two/three',{'val1':1, 'val2': 33}).then(() => {
    console.log("set!")
    conn.get('user/ryan/one/two/three').then((record) => {
      console.log("get record",record)
      conn.delete('user/ryan/one/two/three').then(() => {
        console.log("delete record")
      }).catch((err) => {
        console.log(err)
      })
    }).catch((err) => {
      console.log(err)
    })    
  }).catch((err) => {
    console.log(err)
  })
  
}

util.getSettings().then((settings) => {
  console.log('Settings:', settings)
  const conn = new Connector(settings)
  conn.on('ready', () => {
    testConnector(conn)
  })
  conn.on('close', () => {
    process.exit()
  })
  conn.on('error', (err) => {
    console.error(err)
  })
}).catch((err) => {
  console.log('Could not create settings object: ')
  console.error(err)
  process.exit(1)
})

