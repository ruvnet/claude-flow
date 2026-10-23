---
name: ruflo-init
description: Poprawna inicjalizacja ruflo w nowym projekcie Claude Code. Uruchom raz na początku każdego nowego projektu. Sprawdza każdy krok przed wykonaniem — bezpieczny przy wielokrotnym uruchomieniu.
---

# ruflo-init — Inicjalizacja ruflo w projekcie

## Kiedy używać
Na początku każdego nowego projektu — zanim zaczniesz używać ruflo MCP tools.
Bezpieczny przy wielokrotnym uruchomieniu (idempotentny).

---

## Krok 1 — DETECT: czy ruflo już zainicjalizowany?

```bash
ls .claude-flow/config.yaml 2>/dev/null && echo "JUZ_INIT" || echo "WYMAGA_INIT"
```

- Jeśli `JUZ_INIT` → przeskocz do Kroku 3 (sprawdź tylko API key i permissions)
- Jeśli `WYMAGA_INIT` → kontynuuj od Kroku 2

---

## Krok 2 — INIT: inicjalizacja ruflo

```bash
ruflo init --minimal
```

Oczekiwany output: `RuFlo V3 initialized successfully!`
Jeśli błąd → sprawdź czy `ruflo` jest zainstalowany: `which ruflo`
Jeśli nie ma: `npm install -g ruflo@latest`

---

## Krok 3 — API KEY: ANTHROPIC_API_KEY w ~/.zshenv

```bash
grep "ANTHROPIC_API_KEY" ~/.zshenv 2>/dev/null && echo "KLUCZ_OK" || echo "BRAK_KLUCZA"
```

Jeśli `BRAK_KLUCZA`:
```bash
# Pobierz klucz z ~/.zshrc jeśli tam jest
KEY=$(grep "ANTHROPIC_API_KEY" ~/.zshrc 2>/dev/null | head -1)
if [ -n "$KEY" ]; then
  echo "# Zmienne dla wszystkich procesów (nie tylko interaktywnych)" >> ~/.zshenv
  echo "$KEY" >> ~/.zshenv
  echo "Klucz przeniesiony z .zshrc do .zshenv"
else
  echo "UWAGA: Dodaj ręcznie do ~/.zshenv: export ANTHROPIC_API_KEY=sk-ant-..."
fi
```

**Dlaczego ~/.zshenv a nie ~/.zshrc:** Ruflo uruchamia się jako subprocess Claude Code (nieinteraktywny) — `.zshrc` nie jest wtedy ładowany. `.zshenv` jest ładowany zawsze.

---

## Krok 4 — MCP: ruflo w .mcp.json

Sprawdź czy `.mcp.json` istnieje i zawiera blok ruflo:

```bash
cat .mcp.json 2>/dev/null | grep -q '"ruflo"' && echo "MCP_OK" || echo "BRAK_MCP"
```

Jeśli `BRAK_MCP` — dodaj do `.mcp.json` (utwórz plik jeśli nie istnieje):

```json
{
  "mcpServers": {
    "ruflo": {
      "command": "ruflo",
      "args": ["mcp", "start"],
      "env": {
        "RUFLO_MODE": "v3",
        "RUFLO_TOPOLOGY": "hierarchical-mesh",
        "RUFLO_MAX_AGENTS": "15",
        "RUFLO_MEMORY_BACKEND": "hybrid"
      },
      "autoStart": false
    }
  }
}
```

Jeśli plik już istnieje z innymi wpisami — dodaj ruflo do istniejącego `mcpServers` obiektu.

---

## Krok 5 — PERMS: mcp__ruflo__* w settings.local.json

```bash
cat .claude/settings.local.json 2>/dev/null | grep -q 'mcp__ruflo__\*' && echo "PERMS_OK" || echo "BRAK_PERMS"
```

Jeśli `BRAK_PERMS`:

```bash
mkdir -p .claude
```

Dodaj lub zaktualizuj `.claude/settings.local.json`:

```json
{
  "permissions": {
    "allow": [
      "mcp__ruflo__*"
    ]
  }
}
```

Jeśli plik już istnieje — dopisz `"mcp__ruflo__*"` do istniejącej listy `allow`.

---

## Krok 6 — MEMORY: inicjalizacja bazy pamięci

```bash
ruflo memory init --backend hybrid 2>&1
```

Następnie zaktualizuj `.claude-flow/config.yaml` — ustaw:

```yaml
memory:
  backend: hybrid

swarm:
  topology: hierarchical-mesh
  maxAgents: 15
```

---

## Krok 7 — DAEMON: uruchom background worker

```bash
ruflo daemon start 2>&1
```

Oczekiwany output: `[OK] Daemon started in background (PID: XXXX)`

**Uwaga znana:** ruflo v3.5.48 ma bug — daemon może umierać po starcie z powodu `agentdb/dist/controllers` not found. To błąd producenta, nie blokuje MCP. Zgłoszony na GitHub: https://github.com/ruvnet/claude-flow/issues

---

## Krok 8 — VERIFY: ruflo doctor

```bash
ruflo doctor 2>&1
```

**Oczekiwane minimum (projekt gotowy do pracy):**
- ✅ Config File
- ✅ Memory Database
- ✅ API Keys: Found ANTHROPIC_API_KEY
- ✅ MCP Servers: ruflo configured

**Akceptowalne ostrzeżenia (nie blokują pracy):**
- ⚠ Daemon Status — bug v3.5.48, MCP mimo to działa
- ⚠ TypeScript — tylko jeśli projekt nie jest Node.js
- ⚠ agentic-flow — opcjonalne, instluj lokalnie: `npm install agentic-flow@latest`
- ⚠ Version Freshness — zaktualizuj gdy wyjdzie nowa wersja: `npm update -g ruflo`

**Niedopuszczalne (napraw przed pracą):**
- ⚠ API Keys: No API keys found → wróć do Kroku 3
- ⚠ Config File: No config file → wróć do Kroku 2
- ⚠ MCP Servers: 0 servers → wróć do Kroku 4

---

## Krok 9 — HANDOFF: zapisz stan w session-handoff.md

Dopisz do `.claude/session-handoff.md` (utwórz jeśli nie istnieje):

```markdown
## Ruflo — stan inicjalizacji

- Data: YYYY-MM-DD
- Wersja: ruflo vX.X.XX
- Config: .claude-flow/config.yaml ✅
- Memory: .swarm/memory.db ✅
- API Key: ~/.zshenv ✅
- MCP: .mcp.json ✅
- Permissions: .claude/settings.local.json ✅
- Daemon: [RUNNING pid XXXX / BUG v3.5.48]
- Doctor: X passed, Y warnings
```

---

## Wynik końcowy

Po pomyślnym wykonaniu wszystkich kroków ruflo jest gotowy do użycia w Claude Code.
Narzędzia `mcp__ruflo__*` są dostępne w tym chacie po **restarcie sesji Claude Code** (MCP serwery ładują się przy starcie).

## Znane problemy

| Problem | Przyczyna | Rozwiązanie |
|---------|-----------|-------------|
| Daemon umiera natychmiast | Bug agentdb w ruflo v3.5.48 | Czekaj na v3.5.49, MCP działa mimo to |
| API key nie widoczny | Klucz w .zshrc, nie .zshenv | Krok 3 tego skilla |
| mcp__ruflo__* niedostępne po init | MCP ładuje się przy starcie CC | Restart sesji Claude Code |
| agentic-flow not installed | Brak lokalnej paczki | npm install agentic-flow@latest |
