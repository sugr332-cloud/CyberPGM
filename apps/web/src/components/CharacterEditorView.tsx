import { AddSpecializedSkill } from './AddSpecializedSkill.js';
import { RoleInfoPanel } from './RoleInfoPanel.js';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CharacterSheet,
  CharacterStats,
  CyberwareEntry,
  InventoryEntry,
  ROLES,
  SKILL_CATALOG,
  getSkillDef,
  formatSkillName,
  generateUlid,
  skillNameToKey,
} from '@cyberpgm/shared';
import { hpMaxFromStats, maxHumanity } from '@cyberpgm/rules';
import { api } from '../api.js';
import { PortraitPicker } from './PortraitPicker.js';
import { ITEM_KIND_LABELS, ItemSpecs, itemDisplayName, itemSpecLine } from './ItemDetail.js';

type Kind = 'pc' | 'npc' | 'mook';
type StatKey = keyof CharacterStats;

const KIND_LABELS: Record<Kind, string> = { pc: 'PC', npc: 'NPC', mook: 'モブ' };

const STATS: Array<{ key: StatKey; label: string }> = [
  { key: 'int', label: 'INT 知力' },
  { key: 'ref', label: 'REF 反応' },
  { key: 'dex', label: 'DEX 軽業' },
  { key: 'tech', label: 'TECH 技術' },
  { key: 'cool', label: 'COOL 冷却' },
  { key: 'will', label: 'WILL 意志' },
  { key: 'luck', label: 'LUCK 幸運' },
  { key: 'move', label: 'MOVE 移動' },
  { key: 'body', label: 'BODY 体格' },
  { key: 'emp', label: 'EMP 共感' },
];

/** 選べる品目の種類（商店と同じ並び） */
const PICK_KINDS = ['weapon', 'armor', 'cyberware', 'gear', 'clothing', 'ammo', 'drug', 'cyberdeck', 'program', 'upgrade', 'vehicle'];

interface FormState {
  id: string | null;
  kind: Kind;
  name: string;
  role: string;
  portrait: string | null;
  stats: Record<StatKey, string>;
  hpMax: string;
  hp: string;
  spHead: string;
  spBody: string;
  humanity: string;
  eb: string;
  skills: Record<string, number>;
  inventory: InventoryEntry[];
  cyberware: CyberwareEntry[];
  /** 品目と結び付いていない名前だけの武器（以前のデータ） */
  weapons: string[];
  /** 新しく作るときは、GM が自分で入れるまで HP と人間性を計算値にする */
  hpAuto: boolean;
  humanityAuto: boolean;
}

const emptyStats = (): Record<StatKey, string> =>
  Object.fromEntries(STATS.map((s) => [s.key, ''])) as Record<StatKey, string>;

function newForm(kind: Kind): FormState {
  return {
    id: null,
    kind,
    name: '',
    role: '',
    portrait: null,
    stats: emptyStats(),
    hpMax: '',
    hp: '',
    spHead: '0',
    spBody: '0',
    humanity: '',
    eb: '0',
    skills: {},
    inventory: [],
    cyberware: [],
    weapons: [],
    hpAuto: true,
    humanityAuto: true,
  };
}

function formFromCharacter(c: CharacterSheet): FormState {
  // 以前の簡易作成で入った「Handgun」などの技能名はカタログのキーにそろえる
  const skills: Record<string, number> = {};
  for (const [k, v] of Object.entries(c.skills || {})) skills[skillNameToKey(k) || k] = v;
  return {
    id: c.id,
    kind: c.kind,
    name: c.name,
    role: c.role,
    portrait: c.portrait_image_id ?? null,
    stats: Object.fromEntries(STATS.map((s) => [s.key, String(c.stats?.[s.key] ?? '')])) as Record<StatKey, string>,
    hpMax: String(c.hp_max),
    hp: String(c.hp),
    spHead: String(c.sp_head ?? 0),
    spBody: String(c.sp_body ?? 0),
    humanity: String(c.humanity),
    eb: String(c.eb ?? 0),
    skills,
    inventory: (c.inventory || []).map((i) => ({ ...i })),
    cyberware: (c.cyberware || []).map((cw) => ({ ...cw })),
    weapons: (c.weapons || []).filter((w): w is string => typeof w === 'string'),
    hpAuto: false,
    humanityAuto: false,
  };
}

const toInt = (v: string): number | null => {
  if (v.trim() === '') return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
};

const field: React.CSSProperties = {
  padding: '6px 8px',
  backgroundColor: 'var(--color-bg)',
  border: '1px solid var(--color-border-light)',
  borderRadius: '4px',
  color: 'var(--color-text)',
  fontSize: '0.85rem',
};
const panel: React.CSSProperties = {
  backgroundColor: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: '8px',
  padding: '14px 16px',
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
};
const heading: React.CSSProperties = { fontSize: '0.95rem', fontWeight: 700 };
const muted: React.CSSProperties = { color: 'var(--color-text-muted)', fontSize: '0.75rem' };
const smallButton: React.CSSProperties = {
  padding: '3px 8px',
  borderRadius: '4px',
  border: '1px solid var(--color-border)',
  backgroundColor: 'var(--color-surface-elevated)',
  color: 'var(--color-text)',
  fontSize: '0.75rem',
  cursor: 'pointer',
};

interface Props {
  characters: CharacterSheet[];
  onSaved: () => void;
  /** PC タブの「編集」「＋ PC 追加」から開いたときの対象（ID か、新しく作る種類） */
  request?: { id: string } | { kind: Kind } | null;
  onRequestHandled?: () => void;
}

/**
 * キャラ作成（Phase 5f）: GM が PC・NPC・モブを作る・直す。
 * 能力値は空欄から入れる（決まった値を勝手に入れない）。武器・防具・サイバーウェア・持ち物は品目の一覧から選び、選ぶと性能と効果が出る。
 */
export function CharacterEditorView({ characters, onSaved, request, onRequestHandled }: Props) {
  const [form, setForm] = useState<FormState>(() => newForm('npc'));
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 品目の情報（ID → 品目）。防具の SP と詳細の表示に使う
  const [itemsById, setItemsById] = useState<Record<string, any>>({});
  const remember = (list: any[]) => setItemsById((prev) => ({ ...prev, ...Object.fromEntries(list.map((i) => [i.id, i])) }));

  const [pickKind, setPickKind] = useState('weapon');
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [preview, setPreview] = useState<any | null>(null);
  /** 「品目から探す」で置き換える名前だけの武器 */
  const [linkingWeapon, setLinkingWeapon] = useState<string | null>(null);
  const latestSearch = useRef(0);

  const [skillSearch, setSkillSearch] = useState('');
  const [onlyLearned, setOnlyLearned] = useState(false);

  const open = (next: FormState) => {
    setForm(next);
    setPreview(null);
    setLinkingWeapon(null);
    setMessage(null);
  };

  useEffect(() => {
    if (!request) return;
    if ('id' in request) {
      const c = characters.find((ch) => ch.id === request.id);
      if (!c) return; // 一覧の読み込みを待つ
      open(formFromCharacter(c));
    } else {
      open(newForm(request.kind));
    }
    onRequestHandled?.();
  }, [request, characters]);

  // 持っている品目の情報を読む（防具の SP と詳細のため）
  useEffect(() => {
    const ids = [...form.inventory.map((i) => i.item_id), ...form.cyberware.map((cw) => cw.item_id)].filter(
      (id): id is string => !!id && !itemsById[id],
    );
    if (ids.length === 0) return;
    Promise.all(ids.map((id) => api.getItem(id).catch(() => null))).then((list) => remember(list.filter(Boolean)));
  }, [form.inventory, form.cyberware]);

  // 品目の検索（最後に出した検索の結果だけを使う）
  useEffect(() => {
    const reqId = ++latestSearch.current;
    const t = setTimeout(() => {
      api
        .getItems({ kind: pickKind, q: search.trim() || undefined, sort: 'name_asc', limit: 60 })
        .then((res) => {
          if (reqId !== latestSearch.current) return;
          setResults(res.items);
          remember(res.items);
        })
        .catch(() => undefined);
    }, 200);
    return () => clearTimeout(t);
  }, [pickKind, search]);

  const stat = (k: StatKey) => toInt(form.stats[k]);
  const body = stat('body');
  const will = stat('will');
  const emp = stat('emp');
  const calcHpMax = body !== null && will !== null ? hpMaxFromStats(body, will) : null;
  const calcMaxHumanity =
    emp !== null ? maxHumanity(emp, form.cyberware.map((cw) => ({ type: cw.type, staticLoss: cw.static_loss }))) : null;
  // 作るときの人間性: EMP × 10 からサイバーウェアの決まった減少を引く（プレイヤーのキャラ作成と同じ）
  const calcStartHumanity = emp !== null ? emp * 10 - form.cyberware.reduce((s, cw) => s + (cw.static_loss ?? 0), 0) : null;

  // 新しく作るときは、GM が自分で入れるまで HP と人間性を計算値にする（読み込んだキャラは変えない）
  useEffect(() => {
    const v = calcHpMax !== null ? String(calcHpMax) : '';
    setForm((f) => (f.hpAuto ? { ...f, hpMax: v, hp: v } : f));
  }, [calcHpMax, form.hpAuto]);
  useEffect(() => {
    const v = calcStartHumanity !== null ? String(calcStartHumanity) : '';
    setForm((f) => (f.humanityAuto ? { ...f, humanity: v } : f));
  }, [calcStartHumanity, form.humanityAuto]);

  /** 装備中の防具（シールドを除く）でいちばん高い SP */
  const armorSp = (inventory: InventoryEntry[], known: Record<string, any> = itemsById) => {
    let head = 0;
    let bodySp = 0;
    let any = false;
    for (const inv of inventory) {
      const a = inv.equipped && inv.item_id ? known[inv.item_id]?.armor : null;
      if (!a || a.is_shield) continue;
      any = true;
      head = Math.max(head, a.sp_head ?? 0);
      bodySp = Math.max(bodySp, a.sp_body ?? 0);
    }
    return any ? { head, body: bodySp } : null;
  };
  const equippedArmorSp = armorSp(form.inventory);

  /** 防具を付け外ししたら、SP を装備中の防具に合わせる */
  const setInventory = (inventory: InventoryEntry[], armorChanged: boolean) => {
    setForm((f) => {
      if (!armorChanged) return { ...f, inventory };
      const sp = armorSp(inventory);
      return { ...f, inventory, spHead: String(sp?.head ?? 0), spBody: String(sp?.body ?? 0) };
    });
  };

  const addItem = (item: any) => {
    remember([item]);
    const name = itemDisplayName(item);
    if (item.kind === 'cyberware') {
      const loss = item.cyberware?.humanity_loss_static;
      setForm((f) => ({
        ...f,
        cyberware: [
          ...f.cyberware,
          { item_id: item.id, name, ...(item.cyberware?.cw_type ? { type: item.cyberware.cw_type } : {}), ...(typeof loss === 'number' ? { static_loss: loss } : {}) },
        ],
      }));
      return;
    }
    const isEquip = item.kind === 'weapon' || item.kind === 'armor';
    const replaced = item.kind === 'weapon' ? linkingWeapon : null;
    if (replaced) setLinkingWeapon(null);
    const existing = form.inventory.find((i) => i.item_id === item.id);
    if (existing && !isEquip) {
      setInventory(form.inventory.map((i) => (i === existing ? { ...i, qty: i.qty + 1 } : i)), false);
      return;
    }
    const entry: InventoryEntry = { entry_id: generateUlid(), item_id: item.id, name, kind: item.kind, qty: 1, ...(isEquip ? { equipped: true } : {}) };
    // 足したばかりの防具は itemsById にまだないので、その品目も入れて SP を計算する
    setForm((f) => {
      const inventory = [...f.inventory, entry];
      if (replaced) return { ...f, inventory, weapons: f.weapons.filter((w) => w !== replaced) };
      if (item.kind !== 'armor') return { ...f, inventory };
      const sp = armorSp(inventory, { ...itemsById, [item.id]: item });
      return { ...f, inventory, spHead: String(sp?.head ?? 0), spBody: String(sp?.body ?? 0) };
    });
  };

  const showDetail = async (itemId?: string) => {
    if (!itemId) return;
    if (itemsById[itemId]) {
      setPreview(itemsById[itemId]);
      return;
    }
    const it = await api.getItem(itemId).catch(() => null);
    if (it) {
      remember([it]);
      setPreview(it);
    }
  };

  const missing: string[] = [];
  if (!form.name.trim()) missing.push('名前');
  if (!form.role.trim()) missing.push('ロール');
  for (const s of STATS) {
    const v = stat(s.key);
    const min = s.key === 'luck' ? 0 : 1;
    if (v === null || v < min || v > 10) missing.push(s.label.split(' ')[0]);
  }
  const hpMaxNum = toInt(form.hpMax);
  if (hpMaxNum === null || hpMaxNum < 1) missing.push('最大 HP');
  const humanityNum = toInt(form.humanity);
  if (humanityNum === null) missing.push('人間性');

  const save = async () => {
    if (missing.length > 0) return;
    setSaving(true);
    setMessage(null);
    try {
      const stats = Object.fromEntries(STATS.map((s) => [s.key, stat(s.key)])) as unknown as CharacterStats;
      const hpNum = toInt(form.hp);
      const data = {
        name: form.name.trim(),
        role: form.role.trim(),
        portrait_image_id: form.portrait,
        stats,
        skills: form.skills,
        hp_max: hpMaxNum!,
        hp: hpNum === null ? hpMaxNum! : Math.min(hpNum, hpMaxNum!),
        sp_head: toInt(form.spHead) ?? 0,
        sp_body: toInt(form.spBody) ?? 0,
        humanity: humanityNum!,
        emp_max: stats.emp,
        eb: toInt(form.eb) ?? 0,
        inventory: form.inventory,
        cyberware: form.cyberware,
        weapons: form.weapons,
      };
      if (form.id) {
        const res = await api.updateCharacter(form.id, data);
        open(formFromCharacter(res.character));
      } else {
        const res = await api.createCharacter({ ...data, kind: form.kind });
        open(formFromCharacter(res.character));
      }
      setMessage('保存しました');
      onSaved();
    } catch (err) {
      setMessage(`保存できませんでした: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const skillRows = useMemo(() => {
    const q = skillSearch.trim().toLowerCase();
    const all = Object.values(SKILL_CATALOG);
    const extra = Object.keys(form.skills).filter((k) => !SKILL_CATALOG[k]);
    return [
      ...all
        .filter((s) => (!onlyLearned || form.skills[s.key] !== undefined) && (!q || s.name.toLowerCase().includes(q) || s.key.includes(q)))
        .map((s) => ({ key: s.key, name: s.name, stat: s.stat as StatKey | undefined })),
      // 種類つきの技能（科学：化学 など。Phase 5u）も、元の技能の能力値で基本値を出す
      ...extra.map((k) => ({ key: k, name: formatSkillName(k), stat: getSkillDef(k)?.stat as StatKey | undefined })),
    ];
  }, [skillSearch, onlyLearned, form.skills]);

  const grouped = (['pc', 'npc', 'mook'] as Kind[]).map((k) => ({ kind: k, list: characters.filter((c) => c.kind === k) }));
  const weaponsInv = form.inventory.filter((i) => i.kind === 'weapon');
  const armorInv = form.inventory.filter((i) => i.kind === 'armor');
  const otherInv = form.inventory.filter((i) => i.kind !== 'weapon' && i.kind !== 'armor');

  const updateEntry = (entry: InventoryEntry, patch: Partial<InventoryEntry>) =>
    setInventory(form.inventory.map((i) => (i === entry ? { ...i, ...patch } : i)), entry.kind === 'armor' && 'equipped' in patch);
  const removeEntry = (entry: InventoryEntry) => setInventory(form.inventory.filter((i) => i !== entry), entry.kind === 'armor');

  const entryRow = (entry: InventoryEntry) => {
    const item = entry.item_id ? itemsById[entry.item_id] : null;
    return (
      <div key={entry.entry_id} data-testid="editor-entry" style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '0.8rem', flexWrap: 'wrap' }}>
        <button type="button" onClick={() => showDetail(entry.item_id)} disabled={!entry.item_id} style={{ ...smallButton, flex: 1, minWidth: '160px', textAlign: 'left', display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
          <span>{entry.name}</span>
          <span style={{ color: 'var(--color-text-muted)' }}>{item ? itemSpecLine(item) : entry.item_id ? '' : '品目なし'}</span>
        </button>
        {(entry.kind === 'weapon' || entry.kind === 'armor') && (
          <label style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            <input type="checkbox" checked={!!entry.equipped} onChange={(e) => updateEntry(entry, { equipped: e.target.checked })} />
            装備
          </label>
        )}
        <label style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          数
          <input aria-label={`${entry.name} の数`} type="number" min={1} value={entry.qty} onChange={(e) => updateEntry(entry, { qty: Math.max(1, Number(e.target.value) || 1) })} style={{ ...field, width: '56px', padding: '3px 6px' }} />
        </label>
        <button type="button" onClick={() => removeEntry(entry)} style={{ ...smallButton, color: 'var(--color-accent)' }}>
          外す
        </button>
      </div>
    );
  };

  return (
    <div data-testid="character-editor" style={{ display: 'flex', gap: '16px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
      {/* キャラの一覧 */}
      <div style={{ ...panel, width: '230px', flexShrink: 0 }}>
        {(['pc', 'npc', 'mook'] as Kind[]).map((k) => (
          <button key={k} type="button" onClick={() => open(newForm(k))} style={{ ...smallButton, padding: '6px 8px', fontWeight: 700, borderColor: k === 'pc' ? 'var(--color-ally)' : 'var(--color-enemy)' }}>
            ＋ {KIND_LABELS[k]}を作る
          </button>
        ))}
        {grouped.map((g) => (
          <div key={g.kind} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={muted}>
              {KIND_LABELS[g.kind]}（{g.list.length}）
            </div>
            {g.list.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => open(formFromCharacter(c))}
                style={{
                  ...smallButton,
                  textAlign: 'left',
                  backgroundColor: form.id === c.id ? 'var(--color-surface-elevated)' : 'transparent',
                  borderColor: form.id === c.id ? 'var(--color-ally)' : 'var(--color-border)',
                }}
              >
                {c.name}
              </button>
            ))}
          </div>
        ))}
      </div>

      <div style={{ flex: 1, minWidth: '320px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {/* 基本 */}
        <div style={panel}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={heading}>{form.id ? `${form.name} を直す（${KIND_LABELS[form.kind]}）` : `新しい${KIND_LABELS[form.kind]}`}</span>
            {!form.id && (
              <div style={{ display: 'flex', gap: '10px', fontSize: '0.85rem' }}>
                {(['pc', 'npc', 'mook'] as Kind[]).map((k) => (
                  <label key={k} style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                    <input type="radio" checked={form.kind === k} onChange={() => setForm((f) => ({ ...f, kind: k }))} />
                    {KIND_LABELS[k]}
                  </label>
                ))}
              </div>
            )}
          </div>
          {form.kind === 'mook' && <div style={muted}>モブは戦闘に入れるたびに 1 体ずつ複製されます（元のデータは変わりません）。</div>}
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, minWidth: '180px' }}>
              <span style={muted}>名前</span>
              <input aria-label="名前" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} style={field} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, minWidth: '160px' }}>
              <span style={muted}>ロール（一覧から選ぶか、自由に書く）</span>
              <input aria-label="ロール" list="editor-roles" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))} style={field} />
              <datalist id="editor-roles">
                {ROLES.map((r) => (
                  <option key={r.key} value={r.nameJa} />
                ))}
              </datalist>
            </label>
            <div style={{ flexBasis: '100%' }}>
              <RoleInfoPanel role={form.role} />
            </div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '110px' }}>
              <span style={muted}>所持金 (eb)</span>
              <input aria-label="所持金" type="number" value={form.eb} onChange={(e) => setForm((f) => ({ ...f, eb: e.target.value }))} style={field} />
            </label>
          </div>
          <div>
            <div style={muted}>立ち絵（表示ウィンドウに出す画像。なくてもよい）</div>
            <PortraitPicker value={form.portrait} onChange={(id) => setForm((f) => ({ ...f, portrait: id }))} />
          </div>
        </div>

        {/* 能力値と派生値 */}
        <div style={panel}>
          <span style={heading}>能力値</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: '8px' }}>
            {STATS.map((s) => (
              <label key={s.key} style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <span style={muted}>{s.label}</span>
                <input
                  aria-label={s.label.split(' ')[0]}
                  type="number"
                  min={s.key === 'luck' ? 0 : 1}
                  max={10}
                  value={form.stats[s.key]}
                  onChange={(e) => setForm((f) => ({ ...f, stats: { ...f.stats, [s.key]: e.target.value } }))}
                  style={{ ...field, textAlign: 'center' }}
                />
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '3px', width: '110px' }}>
              <span style={muted}>最大 HP</span>
              <input
                aria-label="最大 HP"
                type="number"
                value={form.hpMax}
                onChange={(e) => setForm((f) => ({ ...f, hpMax: e.target.value, hpAuto: false }))}
                style={field}
              />
            </label>
            {form.id && (
              <label style={{ display: 'flex', flexDirection: 'column', gap: '3px', width: '110px' }}>
                <span style={muted}>今の HP</span>
                <input aria-label="今の HP" type="number" value={form.hp} onChange={(e) => setForm((f) => ({ ...f, hp: e.target.value }))} style={field} />
              </label>
            )}
            <div style={{ ...muted, display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span data-testid="editor-hp-calc">
                計算値: {calcHpMax ?? '—'}（10 + 5 × (BODY + WILL) ÷ 2 の切り上げ）
              </span>
              {calcHpMax !== null && String(calcHpMax) !== form.hpMax && (
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, hpMax: String(calcHpMax), hp: f.id ? f.hp : String(calcHpMax) }))}
                  style={{ ...smallButton, alignSelf: 'flex-start' }}
                >
                  計算値にする
                </button>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '3px', width: '90px' }}>
              <span style={muted}>SP 頭</span>
              <input aria-label="SP 頭" type="number" value={form.spHead} onChange={(e) => setForm((f) => ({ ...f, spHead: e.target.value }))} style={field} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '3px', width: '90px' }}>
              <span style={muted}>SP 胴</span>
              <input aria-label="SP 胴" type="number" value={form.spBody} onChange={(e) => setForm((f) => ({ ...f, spBody: e.target.value }))} style={field} />
            </label>
            <span style={muted}>
              {equippedArmorSp ? `装備中の防具: 頭 ${equippedArmorSp.head} / 胴 ${equippedArmorSp.body}（防具を付け外しすると合わせます）` : '装備中の防具なし'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '3px', width: '110px' }}>
              <span style={muted}>人間性</span>
              <input
                aria-label="人間性"
                type="number"
                value={form.humanity}
                onChange={(e) => setForm((f) => ({ ...f, humanity: e.target.value, humanityAuto: false }))}
                style={field}
              />
            </label>
            <span style={muted} data-testid="editor-humanity-calc">
              最大 {calcMaxHumanity ?? '—'}（EMP × 10、サイバーウェア 1 つにつき減る）
              {form.id ? '' : ` / 作るときの値: ${calcStartHumanity ?? '—'}（EMP × 10 − サイバーウェアの減少）`}
            </span>
          </div>
        </div>

        {/* 技能 */}
        <div style={panel}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={heading}>技能（基本値 = 能力値 + レベル）</span>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input aria-label="技能を探す" placeholder="技能を探す" value={skillSearch} onChange={(e) => setSkillSearch(e.target.value)} style={{ ...field, width: '150px' }} />
              <label style={{ display: 'flex', gap: '4px', alignItems: 'center', fontSize: '0.8rem' }}>
                <input type="checkbox" checked={onlyLearned} onChange={(e) => setOnlyLearned(e.target.checked)} />
                入れた技能だけ
              </label>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: '4px 12px', maxHeight: '320px', overflowY: 'auto' }}>
            {skillRows.map((s) => {
              const lv = form.skills[s.key];
              const sv = s.stat ? stat(s.stat) : null;
              return (
                <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem' }}>
                  <span style={{ flex: 1 }}>{s.name}</span>
                  <span style={{ ...muted, width: '40px' }}>{s.stat ? s.stat.toUpperCase() : '—'}</span>
                  <input
                    aria-label={`${s.name} のレベル`}
                    type="number"
                    min={0}
                    max={10}
                    value={lv ?? ''}
                    onChange={(e) =>
                      setForm((f) => {
                        const skills = { ...f.skills };
                        if (e.target.value === '') delete skills[s.key];
                        else skills[s.key] = Math.max(0, Number(e.target.value) || 0);
                        return { ...f, skills };
                      })
                    }
                    style={{ ...field, width: '52px', padding: '2px 4px', textAlign: 'center' }}
                  />
                  <span style={{ width: '28px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{lv !== undefined && sv !== null ? sv + lv : '—'}</span>
                </div>
              );
            })}
          </div>
          <AddSpecializedSkill existing={Object.keys(form.skills)} onAdd={(key) => setForm((f) => ({ ...f, skills: { ...f.skills, [key]: f.skills[key] ?? 1 } }))} />
        </div>

        {/* 装備 */}
        <div style={panel}>
          <span style={heading}>武器・防具・サイバーウェア・持ち物</span>
          <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: '280px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={muted}>武器</div>
              {weaponsInv.length === 0 && form.weapons.length === 0 && <span style={muted}>—</span>}
              {weaponsInv.map(entryRow)}
              {form.weapons.map((w, idx) => (
                <div key={`w-${idx}`} style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '0.8rem' }}>
                  <span style={{ flex: 1 }}>{w}</span>
                  <span style={muted}>名前だけ（品目と結び付いていない）</span>
                  <button
                    type="button"
                    onClick={() => {
                      setPickKind('weapon');
                      setSearch('');
                      setLinkingWeapon(w);
                    }}
                    style={smallButton}
                  >
                    品目から探す
                  </button>
                  <button type="button" onClick={() => setForm((f) => ({ ...f, weapons: f.weapons.filter((_, i) => i !== idx) }))} style={{ ...smallButton, color: 'var(--color-accent)' }}>
                    外す
                  </button>
                </div>
              ))}
              <div style={muted}>防具</div>
              {armorInv.length === 0 && <span style={muted}>—</span>}
              {armorInv.map(entryRow)}
              <div style={muted}>サイバーウェア</div>
              {form.cyberware.length === 0 && <span style={muted}>—</span>}
              {form.cyberware.map((cw, idx) => (
                <div key={`cw-${idx}`} data-testid="editor-cyberware" style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '0.8rem' }}>
                  <button type="button" onClick={() => showDetail(cw.item_id)} disabled={!cw.item_id} style={{ ...smallButton, flex: 1, textAlign: 'left', display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                    <span>{cw.name}</span>
                    <span style={{ color: 'var(--color-text-muted)' }}>人間性 −{cw.static_loss ?? '—'}</span>
                  </button>
                  <button type="button" onClick={() => setForm((f) => ({ ...f, cyberware: f.cyberware.filter((_, i) => i !== idx) }))} style={{ ...smallButton, color: 'var(--color-accent)' }}>
                    外す
                  </button>
                </div>
              ))}
              <div style={muted}>その他の持ち物</div>
              {otherInv.length === 0 && <span style={muted}>—</span>}
              {otherInv.map(entryRow)}
            </div>

            {/* 品目を選ぶ */}
            <div style={{ flex: 1, minWidth: '280px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', gap: '6px' }}>
                <select aria-label="品目の種類" value={pickKind} onChange={(e) => setPickKind(e.target.value)} style={field}>
                  {PICK_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {ITEM_KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
                <input aria-label="品目を探す" placeholder="名前で探す" value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...field, flex: 1 }} />
              </div>
              {linkingWeapon && (
                <div style={{ ...muted, color: 'var(--color-warning)', display: 'flex', gap: '8px', alignItems: 'center' }}>
                  「{linkingWeapon}」の代わりに持たせる武器を選んでください
                  <button type="button" onClick={() => setLinkingWeapon(null)} style={smallButton}>
                    やめる
                  </button>
                </div>
              )}
              <div data-testid="editor-item-results" style={{ maxHeight: '220px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                {results.length === 0 && <span style={muted}>見つかりません</span>}
                {results.map((it) => (
                  <button
                    key={it.id}
                    type="button"
                    onClick={() => setPreview(it)}
                    style={{
                      ...smallButton,
                      textAlign: 'left',
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: '8px',
                      borderColor: preview?.id === it.id ? 'var(--color-ally)' : 'var(--color-border)',
                    }}
                  >
                    <span>{itemDisplayName(it)}</span>
                    <span style={{ color: 'var(--color-text-muted)' }}>{itemSpecLine(it)}</span>
                  </button>
                ))}
              </div>
              {preview && (
                <div data-testid="editor-item-preview" style={{ border: '1px solid var(--color-border-light)', borderRadius: '6px', padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontWeight: 700 }}>{itemDisplayName(preview)}</span>
                    <button type="button" onClick={() => addItem(preview)} style={{ ...smallButton, backgroundColor: 'var(--color-ally)', color: '#000', fontWeight: 700 }}>
                      {preview.kind === 'cyberware' ? 'サイバーウェアに入れる' : '持たせる'}
                    </button>
                  </div>
                  <ItemSpecs item={preview} />
                </div>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          {missing.length > 0 && <span style={{ ...muted, color: 'var(--color-warning)' }}>未入力: {missing.join('、')}</span>}
          {message && <span style={{ fontSize: '0.85rem' }}>{message}</span>}
          <button
            type="button"
            onClick={save}
            disabled={saving || missing.length > 0}
            style={{ padding: '8px 18px', borderRadius: '6px', border: 'none', backgroundColor: missing.length > 0 ? 'var(--color-surface-elevated)' : 'var(--color-ally)', color: missing.length > 0 ? 'var(--color-text-muted)' : '#000', fontWeight: 700, cursor: missing.length > 0 ? 'not-allowed' : 'pointer' }}
          >
            {form.id ? '保存する' : '作る'}
          </button>
        </div>
      </div>
    </div>
  );
}
