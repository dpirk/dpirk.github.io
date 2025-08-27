// Innehåll i public/theme-loader.js
(function() {
  const theme = localStorage.getItem('theme');
  if (theme === 'dark') {
    document.documentElement.classList.add('dark-mode');
  }
})();