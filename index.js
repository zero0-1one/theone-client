/* eslint-disable no-console */
'use strict'

const defaultHooks = {
  //hook 函数必须都为 async 函数 或返回 Promise
  cache: async () => {},
  before: async () => {},
  after: async () => {},
  requestOpts: async ({ client, method, action, args, opts }) => {
    let url = client.options.url + action
    let header = Object.assign({}, client.options.header, opts.header)
    let results = { method, url, timeout: opts.timeout }
    if (client._builtInRequest == 'request') {
      results.headers = header
      if (method == 'GET') {
        results.qs = args
      } else if (header['content-type'] == 'application/json') {
        results.body = JSON.stringify(args)
      } else {
        results.form = args
      }
    } else {
      results.header = header
      results.data = args
    }
    return results
  },

  retry: async () => false, //异常时候重试处理,  如果返回 true 则重试, 返回fasle 不重试
  results: async ({ error, res }) => {
    if (!error) return res
  },
}

module.exports = class TheoneClient {
  constructor(options = {}) {
    this.options = {}
    if (!options.request) throw '未指定request方法!'
    this.setRequest(options.request)
    if (options.mock) {
      this.options.mock = options.mock
      this.options.mockTimeout = options.mockTimeout ? options.mockTimeout.slice(0) : [0, 0]
    }
    this.options.url = options.url || ''
    this.options.hooks = Object.assign({}, defaultHooks, options.hooks)
    this.options.header = Object.assign({}, options.header)
  }

  getBuiltInRequest(name) {
    switch (name) {
      case 'request':
        try {
          let request = require('request')
          this._request = request.defaults({ jar: request.jar() })
        } catch (e) {
          throw new Error('需要安装 request 模块(npm install request)')
        }
        return async opts => {
          return new Promise(resolve => {
            this._request(opts, (error, response, body) => {
              if (error) return void resolve([error, null])
              try {
                response.data = JSON.parse(body)
              } catch (e) {}
              resolve([null, response])
            })
          })
        }
      case 'wxmp':
        return async opts => {
          return new Promise(resolve => {
            wx.request({
              ...opts,
              success(res) {
                resolve([null, res])
              },
              fail(error) {
                resolve([error, null])
              },
            })
          })
        }

      case 'uniapp':
        return async opts => {
          return uni.request(opts)
        }
      default:
        throw new Error('不存在内置request类型 :' + name)
    }
  }

  //request: 必须是 async 函数, 返回值为 [error, res],  参数接受一个 obj 类型参数, 默认{ method,url,data,header}, 可通过 hooks.requestOpts 来定制自己需要的参数
  //正对国内市场 内置了一些 request ,
  setRequest(request) {
    if (typeof request == 'function') {
      this.options.request = request
      this._builtInRequest = undefined
    } else if (typeof request == 'string') {
      this.options.request = this.getBuiltInRequest(request)
      this._builtInRequest = request
    } else {
      throw new Error('request 类型错误')
    }
  }

  //登录后会根据 accountId 分配不同的 apiUrl 以实现负载均衡
  setUrl(url) {
    this.options.url = url
  }

  setHeader(name, value) {
    this.options.header[name] = value
  }

  //随机 [min, max] 区间内的整数
  randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min
  }

  async call(method, action, args, opts = {}) {
    args = args || {}
    method = method.toUpperCase()
    let hooksData = { client: this, method, action, args, opts }
    let hooks = this.options.hooks
    if (opts.hooks) Object.assign({}, hooks, opts.hooks)
    await hooks.before(hooksData).catch(e => console.error(e))
    try {
      if (this.options.mock) {
        return new Promise(resolve => {
          let [min, max] = this.options.mockTimeout
          setTimeout(async () => {
            hooksData.res = { data: this.options.mock[method.toLowerCase()](action, args) }
            resolve(hooksData.res.data)
          }, this.randomInt(min, max))
        })
      } else {
        let error = null
        let res = null
        let options = await hooks.requestOpts(hooksData).catch(e => console.error(e))
        while (true) {
          let rt = await this.options.request(options)
          error = rt[0]
          res = rt[1]
          if (error) {
            if (!opts.retry) break //opts 未指定 retry 为 true
            let isRetry = await hooks.retry(hooksData).catch(e => console.error(e))
            if (isRetry) continue
          }
          break
        }
        hooksData.error = error
        hooksData.res = res
        hooksData.results = await hooks.results(hooksData).catch(e => console.error(e))
        return hooksData.results
      }
    } catch (e) {
      hooksData.error = e
      hooksData.res = null
      return await hooks.results(hooksData).catch(e => console.error(e))
    } finally {
      await hooks.after(hooksData).catch(e => console.error(e))
    }
  }

  async get(action, args, opts = {}) {
    let header = opts.header || {}
    opts.header = Object.assign({ 'content-type': 'application/json' }, header)
    let results = await this.options.hooks.cache({ action, args, opts }).catch(e => console.error(e))
    if (results) return results
    return this.call('GET', action, args, opts)
  }

  async post(action, args, opts = {}) {
    let header = opts.header || {}
    opts.header = Object.assign({ 'content-type': 'application/json' }, header)
    return this.call('POST', action, args, opts)
  }
}
