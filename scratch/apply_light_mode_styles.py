import os

# 1. Update index.css to include .sb-theme-container, .sb-theme-segmented, .sb-theme-pill
with open('Frontend/k6-UI/src/index.css', 'r', encoding='utf-8') as f:
    index_css = f.read().replace('\r\n', '\n')

sb_theme_rules = """
/* Sidebar Executive Dual-Pill Switcher (Global Fallback) */
.sb-theme-container {
  padding: 8px 12px;
  border-top: 1px solid var(--sb-border, rgba(255, 255, 255, 0.08));
}
.sb-theme-segmented {
  display: flex;
  align-items: center;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  padding: 3px;
  gap: 3px;
}
.sb-theme-pill {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--tx2, #94a3b8);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1);
  font-family: inherit;
}
.sb-theme-pill:hover {
  color: var(--tx, #f8fafc);
  background: rgba(255, 255, 255, 0.04);
}
.sb-theme-pill.active {
  background: #1e293b;
  color: #818cf8;
  border-color: rgba(99, 102, 241, 0.35);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
}
.sb-theme-pill.active .sb-theme-icon {
  color: #a5b4fc;
}

[data-theme="light"] .sb-theme-container {
  border-top-color: #e2e8f0 !important;
}
[data-theme="light"] .sb-theme-segmented {
  background: #f1f5f9 !important;
  border-color: #cbd5e1 !important;
}
[data-theme="light"] .sb-theme-pill {
  color: #64748b !important;
}
[data-theme="light"] .sb-theme-pill:hover {
  color: #0f172a !important;
  background: rgba(0, 0, 0, 0.03) !important;
}
[data-theme="light"] .sb-theme-pill.active {
  background: #ffffff !important;
  color: #4f46e5 !important;
  border-color: #cbd5e1 !important;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08) !important;
}
[data-theme="light"] .sb-theme-pill.active .sb-theme-icon {
  color: #4f46e5 !important;
}
"""

if '.sb-theme-segmented' not in index_css:
    index_css = index_css + "\n" + sb_theme_rules
    with open('Frontend/k6-UI/src/index.css', 'w', encoding='utf-8') as f:
        f.write(index_css)
    print("Added sb-theme rules to index.css")
else:
    print("sb-theme rules already in index.css")

# 2. Add complete light mode styling to CreateTest.css
with open('Frontend/k6-UI/src/pages/CreateTest.css', 'r', encoding='utf-8') as f:
    create_test_css = f.read().replace('\r\n', '\n')

create_test_light_mode = """
/* ═══════════════════════════════════════════════════════════
   SCENARIO STUDIO LIGHT MODE OVERRIDES
   ═══════════════════════════════════════════════════════════ */
[data-theme="light"] .ct-tabs {
  background: #f8fafc !important;
  border-bottom: 1px solid #cbd5e1 !important;
}

[data-theme="light"] .ct-tab {
  color: #64748b !important;
}

[data-theme="light"] .ct-tab:hover {
  color: #0f172a !important;
  background: #f1f5f9 !important;
}

[data-theme="light"] .ct-tab.active {
  color: #4f46e5 !important;
  background: #ffffff !important;
  border-bottom-color: #4f46e5 !important;
  font-weight: 700 !important;
}

[data-theme="light"] .scenario-card {
  background: #ffffff !important;
  border: 1px solid #cbd5e1 !important;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.04) !important;
}

[data-theme="light"] .scenario-card:hover {
  border-color: #94a3b8 !important;
}

[data-theme="light"] .step-header {
  background: #f8fafc !important;
  border-bottom: 1px solid #e2e8f0 !important;
}

[data-theme="light"] .step-title {
  color: #0f172a !important;
}

[data-theme="light"] .drag-handle {
  color: #64748b !important;
}

[data-theme="light"] .drag-handle:hover {
  color: #4f46e5 !important;
}

[data-theme="light"] .preview-run-btn {
  background: #eef2ff !important;
  color: #4338ca !important;
  border: 1px solid #c7d2fe !important;
}

[data-theme="light"] .preview-run-btn:hover:not(:disabled) {
  background: #e0e7ff !important;
  color: #3730a3 !important;
}

[data-theme="light"] .duplicate-btn {
  background: #ffffff !important;
  color: #334155 !important;
  border: 1px solid #cbd5e1 !important;
}

[data-theme="light"] .duplicate-btn:hover {
  background: #f1f5f9 !important;
  color: #0f172a !important;
}

[data-theme="light"] .delete-btn {
  background: #fee2e2 !important;
  color: #dc2626 !important;
  border: 1px solid #fca5a5 !important;
}

[data-theme="light"] .delete-btn:hover {
  background: #fecaca !important;
}

[data-theme="light"] .step-grid input,
[data-theme="light"] .step-grid select,
[data-theme="light"] .step-grid textarea,
[data-theme="light"] .form-group input,
[data-theme="light"] .form-group select,
[data-theme="light"] .form-group textarea {
  background: #ffffff !important;
  border: 1px solid #cbd5e1 !important;
  color: #0f172a !important;
}

[data-theme="light"] .step-grid input::placeholder,
[data-theme="light"] .step-grid textarea::placeholder,
[data-theme="light"] .form-group input::placeholder,
[data-theme="light"] .form-group textarea::placeholder {
  color: #94a3b8 !important;
}

[data-theme="light"] .step-grid input:focus,
[data-theme="light"] .step-grid select:focus,
[data-theme="light"] .step-grid textarea:focus,
[data-theme="light"] .form-group input:focus,
[data-theme="light"] .form-group select:focus,
[data-theme="light"] .form-group textarea:focus {
  border-color: #6366f1 !important;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15) !important;
  background: #ffffff !important;
}

[data-theme="light"] .step-grid .enable-box {
  color: #334155 !important;
}

[data-theme="light"] .step-grid .method-box {
  background: #f8fafc !important;
  color: #0f172a !important;
}

[data-theme="light"] .extract-box {
  background: #f8fafc !important;
  border-top: 1px solid #e2e8f0 !important;
}

[data-theme="light"] .extract-toggle {
  color: #0f172a !important;
}

[data-theme="light"] .extract-fields label {
  color: #475569 !important;
}

[data-theme="light"] .extract-fields input {
  background: #ffffff !important;
  border: 1px solid #cbd5e1 !important;
  color: #0f172a !important;
}

[data-theme="light"] .section-label {
  color: #0f172a !important;
}

[data-theme="light"] .form-group label {
  color: #475569 !important;
}

[data-theme="light"] .preview-vars-bar {
  background: #eef2ff !important;
  border: 1px solid #c7d2fe !important;
  color: #3730a3 !important;
}

[data-theme="light"] .preview-var-chip {
  background: #ffffff !important;
  color: #4338ca !important;
  border: 1px solid #cbd5e1 !important;
}

[data-theme="light"] .schedule-box,
[data-theme="light"] .udv-box {
  background: #f8fafc !important;
  border-color: #cbd5e1 !important;
}
"""

if 'SCENARIO STUDIO LIGHT MODE OVERRIDES' not in create_test_css:
    create_test_css = create_test_css + "\n" + create_test_light_mode
    with open('Frontend/k6-UI/src/pages/CreateTest.css', 'w', encoding='utf-8') as f:
        f.write(create_test_css)
    print("Added Light Mode styles to CreateTest.css")
else:
    print("Light Mode styles already in CreateTest.css")
