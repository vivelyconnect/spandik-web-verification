/* global window, document, location, URLSearchParams */
// SP-A-A: Turnstile widget for the Android app's WebView (see native-turnstile.html).
(function () {
  var SITE_KEY = '0x4AAAAAAD-SxNiq7XTU2EYE' // public sitekey, same as frontend/src/components/ui/Turnstile.tsx
  var params = new URLSearchParams(location.search)
  var action = /^[a-z_]{1,32}$/.test(params.get('action') || '') ? params.get('action') : 'native'
  var bridge = window.ReactNativeWebView
  function send(msg) { if (bridge && bridge.postMessage) bridge.postMessage(JSON.stringify(msg)) }
  function note(text) { var m = document.getElementById('msg'); m.textContent = text; m.hidden = false }

  if (!bridge) { note('This page is part of the Spandik Android app.'); return }

  var s = document.createElement('script')
  s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
  s.async = true
  s.onerror = function () { send({ type: 'error' }) }
  s.onload = function () {
    var id = window.turnstile.render('#widget', {
      sitekey: SITE_KEY, action: action, theme: 'auto', language: params.get('lang') || 'auto',
      callback: function (token) { send({ type: 'token', token: token }) },
      'error-callback': function () { send({ type: 'error' }) },
      'expired-callback': function () { window.turnstile.reset(id) },
    })
  }
  document.head.appendChild(s)
})()
