'use strict'

module.exports =  class {
  constructor(options) {
    this.init(options)
  }

  init(options = {}) {
    this.apiOptions = {}
    if (!options.request) throw '未指定request方法, request必须是 async 方法或返回 Promise.  await 后的返回值必须是:[error, res] 形式'
    this.apiOptions.request = options.request

    if (options.mock) {
      this.apiOptions.mock = options.mock
      this.apiOptions.mockTimeout = options.mockTimeout || [0, 0]
    }
    this.apiOptions.url = options.url || ''
    this.apiOptions.hooks = Object.assign({
      //hook 函数必须都为 async 函数 或返回 Promise
      before: async () => { },
      after: async () => { },
      retry: async () => false,   //异常时候重试处理,  如果返回 true 则重试, 返回fasle 不重试
      results: async ({ error, res }) => { if (!error) return res.data }
    }, options.hooks || {})
    this.apiOptions.header = options.header || {}
  }

  //登录后会根据 accountId 分配不同的 apiUrl 以实现负载均衡
  setUrl(url) {
    this.apiOptions.url = url
  }

  setHeader(name, value) {
    this.apiOptions.header[name] = value
  }

  //随机 [min, max] 区间内的整数
  randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min
  }

  async call(method, action, args = {}, header = {}, opts = {}) {
    let hooksData = { method, action, args, header, opts }
    await this.apiOptions.hooks.before(hooksData).catch(() => { })
    try {
      if (this.apiOptions.mock) {
        return new Promise((resolve, reject) => {
          let [min, max] = this.apiOptions.mockTimeout
          setTimeout(async () => {
            hooksData.res = { data: this.apiOptions.mock[method.toLowerCase()](action, args) }
            resolve(hooksData.res.data)
          }, this.randomInt(min, max))
        })
      } else {
        let error = null
        let res = null
        while (true) {
          [error, res] = await this.apiOptions.request({
            method,
            url: this.apiOptions.url + action,
            data: args,
            header: Object.assign({}, this.apiOptions.header, header)
          })
          if (error) {
            if (!opts.retry) break //opts 未指定 retry 为 true
            let isRetry = await this.apiOptions.hooks.retry(hooksData).catch(() => { })
            if (isRetry) continue
          }
          break
        }
        hooksData.error = error
        hooksData.res = res
        hooksData.results = await this.apiOptions.hooks.results(hooksData).catch(() => { })
        return hooksData.results
      }
    } finally {
      await this.apiOptions.hooks.after(hooksData).catch(() => { })
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
