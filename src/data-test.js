const Connector = require('./connector')
const util = require('./util')

const testConnector = (conn) => {
  conn.set('test_composite_deep/one/two/three/four',{'val1':1, 'val2': 33}).then(() => {
    console.log("set!")
    conn.get('test_composite_deep/one/two/three/four').then((record) => {
      console.log("get record",record)
      conn.delete('test_composite_deep/one/two/three/four').then(() => {
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

