'use strict'

/* global describe, expect, it, jasmine */
const expect = require('chai').expect
const CacheConnector = require('../src/connector')
const util = require('../src/util')
const EventEmitter = require('events').EventEmitter
const MESSAGE_TIME = 20

describe( 'the message connector has the correct structure', () => {
  var cacheConnector

  it( 'throws an error if required connection parameters are missing', () => {
    expect( () => { new CacheConnector( 'gibberish' ) } ).to.throw()
  })

  it( 'creates the cacheConnector', ( done ) => {
    util.getSettings().then(settings => {
      cacheConnector = new CacheConnector( settings )
      expect( cacheConnector.isReady ).to.equal( false )
      cacheConnector.on( 'ready', done )
    })
  })

  it( 'implements the cache/storage connector interface', () =>  {
    expect( cacheConnector.name ).to.be.a( 'string' )
    expect( cacheConnector.version ).to.be.a( 'string' )
    expect( cacheConnector.get ).to.be.a( 'function' )
    expect( cacheConnector.set ).to.be.a( 'function' )
    expect( cacheConnector.delete ).to.be.a( 'function' )
    expect( cacheConnector instanceof EventEmitter ).to.equal( true )
  })

  it( 'retrieves a non existing value', ( done ) => {
    cacheConnector.get( 'someTable/someValue', ( error, value ) => {
      expect( error ).to.equal( null )
      expect( value ).to.equal( null )
      done()
    })
  })

  it( 'sets a value', ( done ) => {
    cacheConnector.set( 'someTable/someValue', {  _d: { v: 10 }, firstname: 'Wolfram' }, ( error ) => {
      expect( error ).to.equal( null )
      done()
    })
  })

  it( 'retrieves an existing value', ( done ) => {
    cacheConnector.get( 'someTable/someValue', ( error, value ) => {
      console.log(error)
      expect( error ).to.equal( null )
      expect( value ).to.deep.equal( {  _d: { v: 10 }, firstname: 'Wolfram' } )
      done()
    })
  })

  it( 'deletes a value', ( done ) => {
    cacheConnector.delete( 'someTable/someValue', ( error ) => {
      expect( error ).to.equal( null )
      done()
    })
  })

  it( 'Can\'t retrieve a deleted value', ( done ) => {
    cacheConnector.get( 'someTable/someValue', ( error, value ) => {
      expect( error ).to.equal( null )
      expect( value ).to.equal( null )
      done()
    })
  })

})