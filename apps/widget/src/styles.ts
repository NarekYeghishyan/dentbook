/**
 * Стили формы — строкой внутри Shadow DOM (ADR-0002): стили сайта клиники их не трогают,
 * и наоборот. Цвет задаёт клиника: theme.primary_color → --db-primary.
 */
export const css = `
:host { all: initial; display: block; }
.db {
  --db-primary: #0d9488;
  --db-text: #0f172a;
  --db-muted: #64748b;
  --db-line: #e2e8f0;
  --db-bg: #fff;
  --db-soft: #f1f5f9;
  box-sizing: border-box;
  max-width: 560px;
  margin: 0 auto;
  padding: 20px;
  border: 1px solid var(--db-line);
  border-radius: 12px;
  background: var(--db-bg);
  color: var(--db-text);
  font: 15px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
.db *, .db *::before, .db *::after { box-sizing: inherit; }
.db h2 { margin: 0 0 14px; font-size: 18px; font-weight: 650; }
.db p { margin: 0 0 12px; }
.muted { color: var(--db-muted); font-size: 13px; }
.bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 14px; }
.bar h2 { margin: 0; }
.list { display: grid; gap: 8px; }
.item {
  display: flex; justify-content: space-between; align-items: center; gap: 12px;
  width: 100%; padding: 12px 14px; text-align: left;
  border: 1px solid var(--db-line); border-radius: 10px; background: var(--db-bg);
  color: inherit; font: inherit; cursor: pointer;
}
.item:hover, .item:focus-visible { border-color: var(--db-primary); outline: none; }
.item small { display: block; color: var(--db-muted); font-size: 13px; }
.days { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 6px; margin-bottom: 10px; }
.day {
  flex: 0 0 auto; min-width: 64px; padding: 8px 10px; text-align: center;
  border: 1px solid var(--db-line); border-radius: 10px; background: var(--db-bg);
  color: inherit; font: inherit; font-size: 13px; cursor: pointer;
}
.day[aria-pressed="true"] { border-color: var(--db-primary); background: var(--db-primary); color: #fff; }
.day:disabled { opacity: .4; cursor: default; }
.slots { display: grid; grid-template-columns: repeat(auto-fill, minmax(84px, 1fr)); gap: 6px; }
.slot {
  padding: 9px 6px; border: 1px solid var(--db-line); border-radius: 8px;
  background: var(--db-soft); color: inherit; font: inherit; font-size: 14px; cursor: pointer;
}
.slot:hover, .slot:focus-visible { border-color: var(--db-primary); outline: none; }
.nav { display: flex; justify-content: space-between; margin: 12px 0 0; }
.btn {
  display: inline-flex; justify-content: center; align-items: center; gap: 6px;
  padding: 10px 16px; border: 0; border-radius: 10px;
  background: var(--db-primary); color: #fff; font: inherit; font-weight: 600; cursor: pointer;
}
.btn.wide { width: 100%; }
.btn:disabled { opacity: .6; cursor: default; }
.link {
  padding: 4px 0; border: 0; background: none; color: var(--db-primary);
  font: inherit; font-size: 14px; cursor: pointer;
}
.link:disabled { color: var(--db-muted); cursor: default; }
label { display: block; margin-bottom: 12px; font-size: 14px; font-weight: 550; }
input, select, textarea {
  display: block; width: 100%; margin-top: 4px; padding: 10px 12px;
  border: 1px solid var(--db-line); border-radius: 10px;
  font: inherit; font-weight: 400; color: inherit; background: var(--db-bg);
}
input:focus, select:focus, textarea:focus { border-color: var(--db-primary); outline: 2px solid color-mix(in srgb, var(--db-primary) 25%, transparent); }
/* Телефон: список кодов стран и номер в одну строку */
.tel-field { margin-bottom: 12px; }
.tel-field label { margin-bottom: 0; }
.tel { display: flex; gap: 8px; margin-top: 4px; }
.tel select { flex: 0 0 44%; margin-top: 0; min-width: 0; text-overflow: ellipsis; }
.tel input { flex: 1 1 auto; margin-top: 0; min-width: 0; }
.code { font-size: 22px; letter-spacing: .4em; text-align: center; }
.note { padding: 10px 12px; margin-bottom: 12px; border-radius: 10px; background: var(--db-soft); font-size: 14px; }
.error { padding: 10px 12px; margin-bottom: 12px; border-radius: 10px; background: #fef2f2; color: #b91c1c; font-size: 14px; }
.done { text-align: center; }
.done .mark { width: 48px; height: 48px; margin: 4px auto 12px; border-radius: 50%; background: var(--db-primary); color: #fff; font-size: 26px; line-height: 48px; }
.captcha { min-height: 65px; margin-bottom: 12px; }
@media (max-width: 420px) { .db { padding: 14px; border-radius: 0; border-left: 0; border-right: 0; } }
`;
