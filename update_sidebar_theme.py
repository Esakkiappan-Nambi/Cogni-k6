import os

sb_path = os.path.join(os.path.dirname(__file__), "Frontend", "k6-UI", "src", "components", "Sidebar.jsx")
with open(sb_path, "r", encoding="utf-8") as f:
    text = f.read()

old_theme_block = """      {/* ── Theme Mode Toggle ── */}
      <div className="sb-theme-toggle-row">
        <button
          className="sb-theme-btn"
          type="button"
          onClick={toggleTheme}
          title={`Switch to ${theme === "dark" ? "Light" : "Dark"} Mode`}
        >
          {theme === "dark" ? (
            <>
              <Sun size={15} style={{ color: "#fbbf24" }} />
              <span>Light Mode</span>
            </>
          ) : (
            <>
              <Moon size={15} style={{ color: "#818cf8" }} />
              <span>Dark Mode</span>
            </>
          )}
        </button>
      </div>"""

new_theme_block = """      {/* ── Enterprise Segmented Theme Switcher ── */}
      <div className="sb-theme-switcher-container">
        <div className="sb-theme-segmented">
          <button
            type="button"
            className={`sb-theme-segment ${theme === "dark" ? "active" : ""}`}
            onClick={() => setTheme("dark")}
            title="Dark Theme"
          >
            <Moon size={12} />
            <span>Dark</span>
          </button>
          <button
            type="button"
            className={`sb-theme-segment ${theme === "light" ? "active" : ""}`}
            onClick={() => setTheme("light")}
            title="Light Theme"
          >
            <Sun size={12} />
            <span>Light</span>
          </button>
        </div>
      </div>"""

text = text.replace(old_theme_block, new_theme_block)

with open(sb_path, "wb") as f:
    f.write(text.replace("\r\n", "\n").replace("\n", "\r\n").encode("utf-8"))
print("Done updating Sidebar.jsx theme switcher!")
