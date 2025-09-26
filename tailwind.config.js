/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",     // Página de login
    "./dashboard.html", // Adicionamos a nova página
    "./main.js",        // E os scripts
    "./dashboard.js",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}