'use strict'
var fs = require('fs')

var isBuffer = Buffer.isBuffer
var Obv = require('obv')
var Append = require('append-batch')
var createStreamCreator = require('pull-cursor')
var Cache = require('hashlru')
var Looper = require('pull-looper')

module.exports = function (blocks, frame, codec, file, cache) {
  var since = Obv()
  cache = cache || Cache(256)
  var offset = blocks.offset

  var append = Append(function (batch, cb) {
    since.once(function () { // wait for file to load before appending...
      batch = batch.map(codec.encode).map(function (e) {
        return Buffer.isBuffer(e) ? e : new Buffer(e)
      })
      var framed = frame.frame(batch, blocks.offset.value)
      var _since = frame.frame.offset
      blocks.append(framed, function (err, offset) {
        if(err) return cb(err)
        //else, get offset of last item.
        since.set(_since)
        cb(null, since.value)
      })
    })
  })

  function getMeta (offset, cb) {
    var data = cache.get(offset)
    if (data) {
      cb(null, data.value, data.prev, data.next)
    }
    else {
      frame.getMeta(offset, function (err, value, prev, next) {
        if(err) return cb(err)

        var data = {
          value: codec.decode(value),
          prev: prev,
          next: next
        }

        cache.set(offset, data)
        cb(null, data.value, data.prev, data.next)
      })
    }
  }

  function getMetaNoCache (offset, cb) {
    frame.getMeta(offset, function (err, value, prev, next) {
      if(err) return cb(err)

      cb(null, codec.decode(value), prev, next)
    })
  }

  var createStream = createStreamCreator(since, getMeta)
  var createStreamNoCache = createStreamCreator(since, getMetaNoCache)

  frame.restore(function (err, offset) {
    if(err) throw err
    since.set(offset)
  })

  return {
    filename: file,
    since: since,
    stream: function (opts) {
      return Looper(createStream(opts))
    },
    streamNoCache: function (opts) {
      return Looper(createStreamNoCache(opts))
    },

    //if value is an array of buffers, then treat that as a batch.
    append: append,

    get: function (offset, cb) {
      frame.getMeta(offset, function (err, value) {
        if(err) cb(err)
        else cb(null, codec.decode(value))
      })
    }
  }
}



