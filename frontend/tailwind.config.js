/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "#f8f9fa",
        surface: "#f8f9fa",
        "surface-container-lowest": "#ffffff",
        "surface-container-low": "#f3f4f5",
        "surface-container": "#edeeef",
        "surface-container-high": "#e7e8e9",
        "surface-variant": "#e1e3e4",
        "on-surface": "#191c1d",
        "on-surface-variant": "#404945",
        outline: "#717975",
        "outline-variant": "#c0c8c4",
        primary: "#3a675a",
        "primary-container": "#b2e2d2",
        "on-primary": "#ffffff",
        "on-primary-container": "#396659",
        secondary: "#5f5c73",
        "secondary-container": "#e1dcf9",
        "on-secondary-container": "#636078",
        tertiary: "#45607e",
        "tertiary-container": "#bedafd",
        "on-tertiary-container": "#44607d",
        error: "#ba1a1a",
        "error-container": "#ffdad6",
      },
      borderRadius: {
        xl: "1.5rem",
        "2xl": "1.5rem",
      },
      fontFamily: {
        display: ["Manrope", "sans-serif"],
        body: ["Hanken Grotesk", "sans-serif"],
      },
      boxShadow: {
        glass: "0 10px 30px rgba(0, 0, 0, 0.03)",
      },
    },
  },
  plugins: [],
};
