var path = require('path')
var cheerio = require('cheerio')
var hljs = require('highlight.js')
var loaderUtils = require('loader-utils')
var markdown = require('markdown-it')
var cache = require('./cache')
var genId = require('./gen-id')
var striptags = require('./strip-tags')

var md = markdown()

/**
 * `{{ }}` => `<span>{{</span> <span>}}</span>`
 * @param  {string} str
 * @return {string}
 */
var replaceDelimiters = function (str) {
  return str.replace(/({{|}})/g, '<span>$1</span>')
}

/**
 * renderHighlight
 * @param  {string} str
 * @param  {string} lang
 */
var renderHighlight = function (str, lang) {
  if (!(lang && hljs.getLanguage(lang))) {
    return ''
  }

  try {
    return replaceDelimiters(hljs.highlight(lang, str, true).value)
  } catch (err) {
  }
}

function convert (str) {
  str = str.replace(/(&#x)(\w{4});/gi, function ($0) {
    return String.fromCharCode(parseInt(encodeURIComponent($0).replace(/(%26%23x)(\w{4})(%3B)/g, '$2'), 16))
  })
  return str
}

function defaultRender (tokens, idx) {
  var m = tokens[idx].info.trim().match(/^demo\s*(.*)$/)
  if (tokens[idx].nesting === 1) {
    var description = (m && m.length > 1) ? m[1] : ''
    let content = tokens[idx + 1].content
    var html = convert(striptags.strip(content, ['script', 'style'])).replace(/(<[^>]*)=""(?=.*>)/g, '$1')
    var descriptionHTML = description ? md.render(description) : ''
    return `<template> 
                        <demo-block class="demo-box">
                            <div class="source" slot="source">${html}</div>
                            ${descriptionHTML}
                            <div class="highlight" slot="highlight">
               `
  } else {
    let content = tokens[idx - 1].content
    var $ = cheerio.load(content, {
      decodeEntities: false,
      lowerCaseAttributeNames: false,
      lowerCaseTags: false
    })
    var output = {
      style: $.html('style'),
      script: $.html('script')
    }
    return `</div></demo-block></template> ${output.script}\n ${output.style}\n`
  }
}

module.exports = function (source) {
  this.cacheable()

  var parser
  var params = loaderUtils.parseQuery(this.query)
  var opts = Object.assign(params, this.vueMarkdown, this.options.vueMarkdown)

  if ({}.toString.call(opts.render) === '[object Function]') {
    parser = opts
  } else {
    opts = Object.assign({
      preset: 'default',
      html: true,
      highlight: renderHighlight
    }, opts)

    var plugins = opts.use
    var preprocess = opts.preprocess

    delete opts.use
    delete opts.preprocess

    parser = markdown(opts.preset, opts)
    if (plugins) {
      plugins.forEach(function (plugin) {
        if (Array.isArray(plugin)) {
          parser.use.apply(parser, plugin)
        } else {
          parser.use(plugin)
        }
      })
    }
  }

  parser.use(require('markdown-it-container'), 'demo', {
    validate: function (params) {
      return params.trim().match(/^demo\s*(.*)$/)
    },
    render: function (tokens, idx) {
      var content
      if (typeof opts.vueRender === 'function') {
        content = opts.vueRender(tokens, idx)
      } else {
        content = defaultRender(tokens, idx)
      }
      if (tokens[idx].nesting === 1) {
        return `<vuecomponent>\n${content}\n`
      } else {
        return `\n${content}</vuecomponent>\n`
      }
    }
  })

  var codeInlineRender = parser.renderer.rules.code_inline
  parser.renderer.rules.code_inline = function () {
    return replaceDelimiters(codeInlineRender.apply(this, arguments))
  }

  if (preprocess) {
    source = preprocess.call(this, parser, source)
  }
  source = source.replace(/@/g, '__at__')

  var filePath = this.resourcePath
  var content = parser.render(source).replace(/__at__/g, '@')
  var fileName = path.basename(filePath, '.md')

  var $ = cheerio.load(content, {
    decodeEntities: false,
    lowerCaseAttributeNames: false,
    lowerCaseTags: false
  })

  var vueComponent = $('vuecomponent')
  var components = []
  var strComponents = []
  for (let i = 0; i < vueComponent.length; i++) {
    components.push($(vueComponent[i]).html())
    $(vueComponent[i]).replaceWith(`<component${i}></component${i}>`)
    let componentFileName = fileName + '-component-' + i
    cache.save(componentFileName, $(vueComponent[i]).html())
    strComponents.push(`component${i}: require('./${componentFileName + '.vue'}')`)
  }
  var scriptStr = `export default {
      components: {
          ${strComponents.join(',')}
      }
  }`
  $('script').replaceWith('')
  var styleStr = $.html('style')

  var vueStr = `
    <template><div>${$.html()}</div></template>\n
    <style>${styleStr}</style>
    <script>${scriptStr}</script>
    `

  filePath = cache.save(fileName + '-' + genId(filePath), vueStr)

  return 'module.exports = require(' +
      loaderUtils.stringifyRequest(this, '!!vue-loader!' + filePath) +
      ');'
}
