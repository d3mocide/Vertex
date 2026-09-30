(function () {
  var d = document.documentElement
  // navigator.standalone exists only on iOS: the installed iPhone app,
  // where iOS 26+ blurs the top of the page (see --edge-clear in index.css).
  if (navigator.standalone === true) d.classList.add('ios-pwa')
  function apply() {
    var standalone = navigator.standalone === true ||
      (window.matchMedia && matchMedia('(display-mode: standalone)').matches)
    var portrait = !window.matchMedia || matchMedia('(orientation: portrait)').matches
    // screen.height doesn't rotate on iOS, so only trust it in portrait.
    // Measure against the layout viewport (docEl), which sizes html.
    // innerHeight is not stable: iOS can correct it to the full screen
    // after launch while the layout viewport stays short.
    var gap = standalone && portrait ? Math.round(screen.height - d.clientHeight) : 0
    // A bigger gap is the keyboard or something else, not the status bar.
    if (gap < 0 || gap > 100) gap = 0
    d.style.setProperty('--ios-bottom-shim', gap + 'px')
    if (gap > 0) d.classList.add('ios-shim'); else d.classList.remove('ios-shim')
  }
  apply()
  window.addEventListener('resize', apply)
  window.addEventListener('orientationchange', apply)
  if (window.visualViewport) window.visualViewport.addEventListener('resize', apply)
  // The extended page is taller than the viewport; keep it from scrolling.
  window.addEventListener('scroll', function () {
    if (d.classList.contains('ios-shim') && window.scrollY) window.scrollTo(0, 0)
  }, { passive: true })
})()
