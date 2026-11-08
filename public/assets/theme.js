/* Runs before the first paint so the board never flashes the wrong theme.
   Kept as a separate file (not inline) because the CSP forbids inline script. */
(function () {
  try {
    var stored = localStorage.getItem("sift.theme");
    var theme = stored === "dark" || stored === "light" ? stored : null;
    if (!theme) {
      theme = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    }
    document.documentElement.setAttribute("data-theme", theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "light" ? "#f7f4ee" : "#0c0b0a");
  } catch (error) {
    /* private mode, storage disabled: the dark default in the markup stands. */
  }
})();
