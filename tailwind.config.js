// tailwind.config.js
export default {
  content: [
    "./index.html",
    "./dashboard.html",
    "./main.js",
    "./dashboard.js",
    "./src/pages/**/*.js",     // scripts das abas
    "./public/pages/**/*.html" // HTML das abas (agora em public)
  ],
  theme: { extend: {} },
  plugins: [],
}
