with open('Frontend/k6-UI/src/pages/History.jsx', 'r', encoding='utf-8') as f:
    text = f.read()

text = text.replace('\r\n', '\n')

old_import = """import {
  Trash2, Search, ExternalLink, FileText,
  BarChart3, Plus, ChevronLeft, ChevronRight, Loader2,
  ArrowUpDown, ArrowUp, ArrowDown, Gauge,
} from "lucide-react";"""

new_import = """import {
  Trash2, Search, FileText,
  BarChart3, Plus, ChevronLeft, ChevronRight, Loader2,
  ArrowUpDown, ArrowUp, ArrowDown, Gauge, Activity,
} from "lucide-react";"""

assert old_import in text, "old_import not found"
text = text.replace(old_import, new_import)

old_telemetry = """  const [telemetry, setTelemetry] = useState({
    grafana_online: false,
    influxdb_online: false,
  });"""
if old_telemetry in text:
    text = text.replace(old_telemetry, "")

old_effect = """  useEffect(() => {
    API.get("/telemetry-status")
      .then((r) => setTelemetry(r.data || {}))
      .catch(() => {});
  }, []);"""
if old_effect in text:
    text = text.replace(old_effect, "")

with open('Frontend/k6-UI/src/pages/History.jsx', 'w', encoding='utf-8') as f:
    f.write(text)

print("History.jsx fixed successfully!")
