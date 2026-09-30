// Hide loader when React mounts
window.addEventListener('load', () => {
  const loader = document.getElementById('loader')
  if (loader) {
    setTimeout(() => {
      loader.classList.add('hidden')
    }, 500)
  }
})
