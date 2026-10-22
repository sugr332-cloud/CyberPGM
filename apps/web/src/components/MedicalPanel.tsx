import { useEffect, useState } from 'react';
import { CharacterSheet, DRUGS, THERAPIES, TRAUMAS, medicalOf, cyberpsychosisStage } from '@cyberpgm/shared';
import { gmFetch } from '../api.js';

interface Props {
  character: CharacterSheet;
  characters: CharacterSheet[];
  /** 変えたあとに一覧を読み直す */
  onChanged: () => void;
}

const field: React.CSSProperties = {
  padding: '4px 6px',
  fontSize: '0.8rem',
  borderRadius: '4px',
  border: '1px solid var(--color-border-light)',
  backgroundColor: 'var(--color-bg)',
  color: 'var(--color-text)',
};
const row: React.CSSProperties = { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', fontSize: '0.8rem' };
const h: React.CSSProperties = { fontWeight: 700, fontSize: '0.85rem', marginTop: '6px' };
const muted: React.CSSProperties = { color: 'var(--color-text-muted)', fontSize: '0.75rem' };

const nums = (s: string) =>
  s
    .split(/[,\s、]+/)
    .map((x) => Number(x))
    .filter((n) => Number.isInteger(n) && n > 0);
const roll = (first: string, extra: string) => (first ? { first: Number(first), ...(extra ? { extra: Number(extra) } : {}) } : undefined);

/**
 * 医療・ドラッグ・セラピー・人間性（Phase 5w。日本語版 p.149〜150、219〜232）。GM の PC・NPC 編集の下に出す
 */
export function MedicalPanel({ character: ch, characters, onChanged }: Props) {
  const m = medicalOf(ch.extra);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [healer, setHealer] = useState(ch.id);
  const [r1, setR1] = useState('');
  const [r2, setR2] = useState('');
  const [cyber, setCyber] = useState(false);
  const [drug, setDrug] = useState<string>(DRUGS[0].key);
  const [doses, setDoses] = useState('1');
  const [givenBy, setGivenBy] = useState('');
  const [dice, setDice] = useState('');
  const [therapyKey, setTherapyKey] = useState('standard');
  const [doctor, setDoctor] = useState('');
  const [therapyDrug, setTherapyDrug] = useState('');
  const [payTherapy, setPayTherapy] = useState(true);
  const [trauma, setTrauma] = useState(TRAUMAS[0].key);
  const [cwItems, setCwItems] = useState<Array<{ id: string; name_ja: string; name_en: string }>>([]);
  const [cwItem, setCwItem] = useState('');
  const [surgeon, setSurgeon] = useState('');
  const [hours, setHours] = useState('24');
  const [rested, setRested] = useState<string[]>([]);

  useEffect(() => {
    gmFetch('/api/items?kind=cyberware&limit=500')
      .then((r) => r.json())
      .then((res) => setCwItems(res.items ?? []))
      .catch(() => undefined);
  }, []);

  const call = async (path: string, body: unknown, method = 'POST') => {
    setErr(null);
    setMsg(null);
    const res = await gmFetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
    if (res.error) setErr(res.error);
    else {
      setMsg(res.formula ?? (res.report ? res.report.join(' / ') || '変化なし' : '反映しました'));
      setR1('');
      setR2('');
      setDice('');
      onChanged();
    }
  };
  const base = `/api/medical/${ch.id}`;
  const others = characters;
  const medtechs = characters.filter((c) => (c.skills?.medical_tech ?? 0) > 0);
  const stage = ch.psychosis ?? cyberpsychosisStage(ch.currentEmp, ch.humanity);
  const rollInputs = (label: string) => (
    <>
      <span>{label}</span>
      <input aria-label={`${label}の出目`} type="number" min={1} max={10} value={r1} onChange={(e) => setR1(e.target.value)} style={{ ...field, width: '48px' }} />
      {(r1 === '10' || r1 === '1') && <input aria-label="追加の出目" type="number" min={1} max={10} value={r2} onChange={(e) => setR2(e.target.value)} style={{ ...field, width: '48px' }} placeholder="追加" />}
    </>
  );

  return (
    <div data-testid="medical-panel" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div style={row}>
        <span>
          人間性 <b>{ch.humanity}</b> / 上限 {ch.maxHumanity}（【共感】{ch.currentEmp}）
        </span>
        {stage.level > 0 && <span style={{ color: stage.level >= 3 ? 'var(--color-danger)' : 'var(--color-warning)' }}>サイバーサイコシス: {stage.label}</span>}
      </div>
      {(ch.effectNotes ?? []).length > 0 && <div style={muted}>効いているもの: {(ch.effectNotes ?? []).join(' / ')}</div>}
      {(m.drugs ?? []).length > 0 && <div style={muted}>ドラッグ・薬品: {(m.drugs ?? []).map((d) => `${DRUGS.find((x) => x.key === d.key)?.name}（残り ${d.hours} 時間）`).join('、')}</div>}
      {(m.addictions ?? []).length > 0 && <div style={{ ...muted, color: 'var(--color-warning)' }}>依存症: {(m.addictions ?? []).map((k) => DRUGS.find((x) => x.key === k)?.name).join('、')}</div>}

      {(m.pending_addiction ?? []).map((p) => {
        const def = DRUGS.find((x) => x.key === p.key)!;
        return (
          <div key={p.key} style={row}>
            <span style={{ color: 'var(--color-warning)' }}>
              {def.name} の二次効果: WILL + 拷問／薬物抵抗 + 1d10 vs 難易度 {def.addictionDv}
            </span>
            {rollInputs('出目')}
            <button type="button" style={field} onClick={() => call(`${base}/addiction`, { drug: p.key, roll: roll(r1, r2) })}>
              判定する
            </button>
          </div>
        );
      })}

      <div style={h}>治療</div>
      <div style={row}>
        <label>
          <input type="checkbox" checked={Boolean(m.healing)} onChange={(e) => call(`${base}/healing`, { on: e.target.checked })} /> 安定化済み（休めば 1 日ごとに【体格】ぶん回復）
        </label>
        <button type="button" style={field} onClick={() => call(`${base}/hospital`, { pay: true })}>
          病院で治す（払う）
        </button>
        <button type="button" style={field} onClick={() => call(`${base}/hospital`, { pay: false })}>
          病院で治す（後払い）
        </button>
        <span>トラウマ・チーム:</span>
        <select aria-label="トラウマ・チームの契約" value={m.trauma_plan ?? ''} onChange={(e) => call(`${base}/trauma-plan`, { plan: e.target.value || null }, 'PUT')} style={field}>
          <option value="">なし</option>
          <option value="silver">シルバー（月 500eb）</option>
          <option value="executive">エグゼクティヴ（月 1,000eb）</option>
        </select>
      </div>
      {(ch.crit_injuries as Array<{ name?: string; summary?: string; quick_fixed?: boolean }>).length > 0 && (
        <>
          <div style={row}>
            <span>治す人:</span>
            <select aria-label="治す人" value={healer} onChange={(e) => setHealer(e.target.value)} style={field}>
              {others.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {rollInputs('出目')}
            <label>
              <input type="checkbox" checked={cyber} onChange={(e) => setCyber(e.target.checked)} /> サイバー部位（〈サイバー技術〉でも可）
            </label>
          </div>
          {(ch.crit_injuries as Array<{ name?: string; summary?: string; quick_fixed?: boolean }>).map((inj, i) => (
            <div key={i} style={row}>
              <span style={{ flex: 1, minWidth: '200px' }}>
                {inj.name}
                {inj.quick_fixed ? '（対症治療ずみ・今日まで）' : ''}: <span style={muted}>{inj.summary}</span>
              </span>
              <button type="button" style={field} onClick={() => call(`${base}/treat`, { index: i, mode: 'quick', healer_id: healer, roll: roll(r1, r2), cybertech: cyber })}>
                対症治療
              </button>
              <button type="button" style={field} onClick={() => call(`${base}/treat`, { index: i, mode: 'full', healer_id: healer, roll: roll(r1, r2), cybertech: cyber })}>
                根本治療
              </button>
            </div>
          ))}
        </>
      )}

      <div style={h}>ドラッグ・薬品</div>
      <div style={row}>
        <select aria-label="ドラッグ・薬品" value={drug} onChange={(e) => setDrug(e.target.value)} style={field}>
          {DRUGS.map((d) => (
            <option key={d.key} value={d.key}>
              {d.name}
              {d.medtechOnly ? '（メドテク）' : ''}
            </option>
          ))}
        </select>
        <input aria-label="回数" type="number" min={1} value={doses} onChange={(e) => setDoses(e.target.value)} style={{ ...field, width: '44px' }} />
        回分
        <select aria-label="投与する人" value={givenBy} onChange={(e) => setGivenBy(e.target.value)} style={field}>
          <option value="">投与する人（自分・ストリート・ドラッグ）</option>
          {medtechs.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}（メドテク）
            </option>
          ))}
        </select>
        {drug === 'black_lace' && <input aria-label="人間性喪失 2d6" placeholder="2d6 の出目 例: 3, 5" value={dice} onChange={(e) => setDice(e.target.value)} style={{ ...field, width: '110px' }} />}
        <button type="button" style={field} onClick={() => call(`${base}/drug`, { drug, doses: Number(doses) || 1, given_by: givenBy || undefined, dice: nums(dice) })}>
          使う
        </button>
      </div>
      <div style={muted}>{DRUGS.find((d) => d.key === drug)?.effect}</div>

      <div style={h}>セラピー（1 週間。メドテクの〈医療技術〉）</div>
      <div style={row}>
        <select aria-label="セラピー" value={therapyKey} onChange={(e) => setTherapyKey(e.target.value)} style={field}>
          {THERAPIES.map((t) => (
            <option key={t.key} value={t.key}>
              {t.name}（{t.cost.toLocaleString()}eb、難易度 {t.dv}）
            </option>
          ))}
        </select>
        {therapyKey === 'addiction' ? (
          <select aria-label="治す依存症" value={therapyDrug} onChange={(e) => setTherapyDrug(e.target.value)} style={field}>
            <option value="">依存症を選ぶ</option>
            {(m.addictions ?? []).map((k) => (
              <option key={k} value={k}>
                {DRUGS.find((x) => x.key === k)?.name}
              </option>
            ))}
          </select>
        ) : (
          <input aria-label="回復する人間性" placeholder={`${THERAPIES.find((t) => t.key === therapyKey)?.dice}d6 の出目`} value={dice} onChange={(e) => setDice(e.target.value)} style={{ ...field, width: '110px' }} />
        )}
        <select aria-label="セラピーをするメドテク" value={doctor} onChange={(e) => setDoctor(e.target.value)} style={field}>
          <option value="">メドテクを選ぶ</option>
          {medtechs.filter((c) => c.id !== ch.id).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {rollInputs('〈医療技術〉')}
        <label>
          <input type="checkbox" checked={payTherapy} onChange={(e) => setPayTherapy(e.target.checked)} /> 費用を払う
        </label>
        <button type="button" style={field} onClick={() => call(`${base}/therapy`, { therapy: therapyKey, doctor_id: doctor, roll: roll(r1, r2), dice: nums(dice), drug: therapyDrug || undefined, pay: payTherapy })}>
          セラピーする
        </button>
      </div>

      <div style={h}>人間性喪失・サイバーウェア</div>
      <div style={row}>
        <select aria-label="トラウマ" value={trauma} onChange={(e) => setTrauma(e.target.value)} style={field}>
          {TRAUMAS.map((t) => (
            <option key={t.key} value={t.key}>
              {t.name}（{t.dice}d6）
            </option>
          ))}
        </select>
        <input aria-label="人間性喪失の出目" placeholder="出目 例: 2, 5" value={dice} onChange={(e) => setDice(e.target.value)} style={{ ...field, width: '100px' }} />
        <button type="button" style={field} onClick={() => call(`${base}/humanity-loss`, { dice: nums(dice), reason: TRAUMAS.find((t) => t.key === trauma)?.name })}>
          人間性を減らす
        </button>
      </div>
      <div style={row}>
        <select aria-label="インストールするサイバーウェア" value={cwItem} onChange={(e) => setCwItem(e.target.value)} style={{ ...field, maxWidth: '220px' }}>
          <option value="">サイバーウェアを選ぶ</option>
          {cwItems.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name_ja || i.name_en}
            </option>
          ))}
        </select>
        <input aria-label="インストールの人間性喪失" placeholder="人間性喪失の出目" value={dice} onChange={(e) => setDice(e.target.value)} style={{ ...field, width: '110px' }} />
        <select aria-label="手術するメドテク" value={surgeon} onChange={(e) => setSurgeon(e.target.value)} style={field}>
          <option value="">医療機関でインストール</option>
          {characters.filter((c) => (c.skills?.surgery ?? 0) > 0).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} が手術（〈外科手術〉）
            </option>
          ))}
        </select>
        {surgeon && rollInputs('〈外科手術〉')}
        <button type="button" style={field} onClick={() => call(`${base}/install`, { item_id: cwItem, dice: nums(dice), surgeon_id: surgeon || undefined, roll: roll(r1, r2) })}>
          インストール
        </button>
      </div>
      {ch.cyberware.length > 0 && (
        <div style={row}>
          <span>外す:</span>
          {ch.cyberware.map((c, i) => (
            <button key={i} type="button" style={field} onClick={() => confirm(`${c.name} を外しますか？`) && call(`${base}/uninstall`, { index: i })}>
              {c.name} ×
            </button>
          ))}
        </div>
      )}

      <div style={h}>時間を進める（全員）</div>
      <div style={row}>
        <input aria-label="進める時間" type="number" min={1} value={hours} onChange={(e) => setHours(e.target.value)} style={{ ...field, width: '60px' }} />
        時間。休んだ人:
        {characters.filter((c) => c.kind === 'pc').map((c) => (
          <label key={c.id}>
            <input type="checkbox" checked={rested.includes(c.id)} onChange={(e) => setRested((prev) => (e.target.checked ? [...prev, c.id] : prev.filter((x) => x !== c.id)))} /> {c.name}
          </label>
        ))}
        <button type="button" style={field} onClick={() => call('/api/medical/time', { hours: Number(hours) || 24, rested_ids: rested })}>
          進める
        </button>
      </div>
      <div style={muted}>ドラッグの時間、1 日 1 回の薬品、自然治癒（休んだ人だけ）、対症治療の期限（その日の終わり）が進みます。</div>

      <div style={row}>
        <button type="button" style={field} onClick={() => call(`${base}/undo`, {})}>
          医療・人間性の操作を 1 つ戻す
        </button>
      </div>
      {msg && <div style={{ fontSize: '0.8rem', color: 'var(--color-ally)' }}>{msg}</div>}
      {err && <div style={{ fontSize: '0.8rem', color: 'var(--color-danger)' }}>{err}</div>}
    </div>
  );
}
