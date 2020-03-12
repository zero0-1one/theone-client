'use strict'


const defaultHooks = {
  //hook 函数必须都为 async 函数 或返回 Promise
  before: async () => { },
  after: async () => { },
  requestOpts: async ({ client, method, args, header }) => {
    return {
      method,
      url: client.options.url + action,
      data: args,
      header: Object.assign({}, client.options.header, header)
    }
  },
  retry: async () => false,   //异常时候重试处理,  如果返回 true 则重试, 返回fasle 不重试
  results: async ({ error, res }) => { if (!error) return res }
}



let request = null
//request: 必须是 async 函数, 返回值为 [error, res],  参数接受一个 obj 类型参数, 默认包含{ method,url,data,header}, 可通过 hooks.requestOpts 来定制自己需要的参数
//正对国内市场 内置了一些 request 
const builtInRequests = {
  //需要再项目中 安装 request 模块
  'request': async function (opts) {
    if (!request) request = request('request')
    request[method.toLowerCase()](url, options, (error, response, body) => {
      if (error) return void resolve([error, null])
      try {
        response.data = JSON.parse(body)
      } catch (e) {
      }
      resolve([null, response])
    })
  },

  'wxmp': async function (opts) {
    return new Promise(resolve => {
      wx.request({
        ...opts,
        success(res) {
          resolve([null, res])
        },
        fail(error) {
          resolve([error, null])
        }
      })
    })
  },

  'uniapp': async function (opts) {
    return uni.request(opts)
  }
}

module.exports = class {
  constructor(options) {
    this.init(options)
  }

  init(options = {}) {
    this.options = {}
    if (!options.request) throw '未指定request方法!'
    if (typeof options.request == 'function') {
      this.options.request = options.request
    } else if (typeof options.request == 'string' && builtInRequests[options.request]) {
      this.options.request = builtInRequests[options.request]
    } else {
      throw '指定的 request 错误'
    }

    if (options.mock) {
      this.options.mock = options.mock
      this.options.mockTimeout = options.mockTimeout || [0, 0]
    }
    this.options.url = options.url || ''
    this.options.hooks = Object.assign(defaultHooks, options.hooks || {})
    this.options.header = options.header || {}
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

  async call(method, action, args = {}, header = {}, opts = {}) {
    let hooksData = { client: this, method, action, args, header, opts }
    let hooks = this.options.hooks
    if (opts.hooks) Object.assign({}, hooks, opts.hooks)

    await hooks.before(hooksData).catch(() => { })
    try {
      if (this.options.mock) {
        return new Promise((resolve, reject) => {
          let [min, max] = this.options.mockTimeout
          setTimeout(async () => {
            hooksData.res = { data: this.options.mock[method.toLowerCase()](action, args) }
            resolve(hooksData.res.data)
          }, this.randomInt(min, max))
        })
      } else {
        let error = null
        let res = null
        let options = await hooks.requestOpts(hooksData)
        while (true) {
          [error, res] = await this.options.request(options)
          if (error) {
            if (!opts.retry) break //opts 未指定 retry 为 true
            let isRetry = await hooks.retry(hooksData).catch(() => { })
            if (isRetry) continue
          }
          break
        }
        hooksData.error = error
        hooksData.res = res
        hooksData.results = await hooks.results(hooksData).catch(() => { })
        return hooksData.results
      }
    } finally {
      await hooks.after(hooksData).catch(() => { })
    }
  }

  async get(action, args, opts) {
    return this.call('GET', action, args, {
      'content-type': 'application/json'
    }, opts)
  }

  async post(action, args, opts) {
    return this.call('POST', action, args, {
      'content-type': 'application/json'
    }, opts)
  }
}

