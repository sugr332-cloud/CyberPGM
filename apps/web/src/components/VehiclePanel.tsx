import { useEffect, useState } from 'react';
import { CharacterSheet, VehicleRec, VEHICLE_UPGRADES, REPUTATION_LEVELS, Reputation, roleRank } from '@cyberpgm/shared';
import { gmFetch } from '../api.js';

interface Props {
  character: CharacterSheet;
  characters: CharacterSheet[];
  onChanged: () => void;
}
const field: React.CSSProperties = { padding: '4px 6px', fontSize: '0.8rem', borderRadius: '4px', border: '1px solid var(--color-border-light)', backgroundColor: 'var(--color-bg)', color: 'var(--color-text)' };
const row: React.CSSProperties = { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', fontSize: '0.8rem' };
const muted: React.CSSProperties = { color: 'var(--color-text-muted)', fontSize: '0.75rem' };

/**
 * ヴィークルと知名度（Phase 5y。日本語版 p.136・161〜165・189〜193）
 */
export function VehiclePanel({ character: ch, characters, onChanged }: Props) {
  const extra = (ch.extra ?? {}) as { vehicles?: VehicleRec[]; reputation?: Reputation };
  const vehicles = extra.vehicles ?? [];
  const [list, setList] = useState<Array<{ id: string; name_ja: string; name_en: string }>>([]);
  const [add, setAdd] = useState('');
  const [family, setFamily] = useState(false);
  const [up, setUp] = useState<Record<string, string>>({});
  const [sev, setSev] = useState<Record<string, string>>({});
  const [mech, setMech] = useState(ch.id);
  const [r1, setR1] = useState('');
  const [r2, setR2] = useState('');
  const [rep, setRep] = useState({ level: String(extra.reputation?.level ?? 0), deed: extra.reputation?.deed ?? '', bad: Boolean(extra.reputation?.bad) });
  const [die, setDie] = useState('');
  const [their, setTheir] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    gmFetch('/api/items?kind=vehicle&limit=100')
      .then((r) => r.json())
      .then((res) => setList(res.items ?? []))
      .catch(() => undefined);
  }, []);
  useEffect(() => setRep({ level: String(extra.reputation?.level ?? 0), deed: extra.reputation?.deed ?? '', bad: Boolean(extra.reputation?.bad) }), [ch.id, ch.updated_at]);

  const op = async (body: Record<string, unknown>) => {
    setErr(null);
    setMsg(null);
    const res = await gmFetch(`/api/vehicles/${ch.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
    if (res.error) setErr(res.error);
    else {
      setMsg(res.formula ?? '反映しました');
      setR1('');
      setR2('');
      onChanged();
    }
  };
  const roll = () => (r1 ? { first: Number(r1), ...(r2 ? { extra: Number(r2) } : {}) } : undefined);
  const moto = roleRank(ch.role, ch.extra, 'Nomad');

  return (
    <div data-testid="vehicle-panel" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {vehicles.map((v) => (
        <div key={v.id} style={{ ...row, borderBottom: '1px solid var(--color-border)', paddingBottom: '4px' }}>
          <b>{v.name}</b>
          {v.family && <span style={muted}>家族</span>}
          <span>
            SDP {v.sdp}/{v.sdp_max}
            {v.sp ? `・SP ${v.sp}` : ''}・座席 {v.seats}・【移動】{v.move}
            {v.out_of_control ? '・制御不能' : ''}
            {v.sdp === 0 ? '・破壊（修理まで動かない）' : ''}
          </span>
          {v.upgrades.length > 0 && <span style={muted}>{v.upgrades.map((u) => VEHICLE_UPGRADES.find((x) => x.en === u)?.name ?? u).join('、')}</span>}
          <select aria-label="アップグレード" value={up[v.id] ?? ''} onChange={(e) => setUp((p) => ({ ...p, [v.id]: e.target.value }))} style={field}>
            <option value="">アップグレードを選ぶ</option>
            {VEHICLE_UPGRADES.map((u) => (
              <option key={u.en} value={u.en} disabled={Boolean(v.family) && moto < u.rank}>
                {u.name}（《モト》{u.rank}）
              </option>
            ))}
          </select>
          <button type="button" style={field} onClick={() => op({ op: 'upgrade', vehicle_id: v.id, upgrade: up[v.id] })}>
            施す
          </button>
          <select aria-label="損傷の程度" value={sev[v.id] ?? 'light'} onChange={(e) => setSev((p) => ({ ...p, [v.id]: e.target.value }))} style={field}>
            <option value="light">軽度（難易度 9・3 時間）</option>
            <option value="heavy">重度（13・1 日）</option>
            <option value="destroyed">破壊（17・1 週間）</option>
          </select>
          <button type="button" style={field} onClick={() => op({ op: 'repair', vehicle_id: v.id, severity: sev[v.id] ?? 'light', mechanic_id: mech, roll: roll() })}>
            修理
          </button>
          {v.family && (
            <button type="button" style={field} onClick={() => op({ op: 'repair', vehicle_id: v.id, severity: 'destroyed', family_repair: true })}>
              家族に直してもらう（1 週間・500eb）
            </button>
          )}
          <button type="button" style={field} onClick={() => confirm(`${v.name} を手放しますか？`) && op({ op: 'remove', vehicle_id: v.id })}>
            ×
          </button>
        </div>
      ))}
      <div style={row}>
        修理する人
        <select aria-label="修理する人" value={mech} onChange={(e) => setMech(e.target.value)} style={field}>
          {characters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        出目
        <input aria-label="修理の出目" type="number" min={1} max={10} value={r1} onChange={(e) => setR1(e.target.value)} style={{ ...field, width: '48px' }} />
        {(r1 === '10' || r1 === '1') && <input aria-label="追加の出目" type="number" min={1} max={10} value={r2} onChange={(e) => setR2(e.target.value)} style={{ ...field, width: '48px' }} />}
      </div>
      <div style={row}>
        <select aria-label="持たせるヴィークル" value={add} onChange={(e) => setAdd(e.target.value)} style={field}>
          <option value="">ヴィークルを選ぶ</option>
          {list.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name_ja || i.name_en}
            </option>
          ))}
        </select>
        <label>
          <input type="checkbox" checked={family} onChange={(e) => setFamily(e.target.checked)} /> ノーマッドの家族のヴィークル
        </label>
        <button type="button" style={field} onClick={() => op({ op: 'add', item_id: add, family })}>
          持たせる
        </button>
      </div>

      <div style={{ fontWeight: 700, fontSize: '0.85rem', marginTop: '6px' }}>知名度と威圧（p.193）</div>
      <div style={row}>
        レベル
        <input aria-label="知名度レベル" type="number" min={0} max={10} value={rep.level} onChange={(e) => setRep((p) => ({ ...p, level: e.target.value }))} style={{ ...field, width: '44px' }} />
        何をして
        <input aria-label="知名度の行為" value={rep.deed} onChange={(e) => setRep((p) => ({ ...p, deed: e.target.value }))} style={{ ...field, width: '180px' }} />
        <label>
          <input type="checkbox" checked={rep.bad} onChange={(e) => setRep((p) => ({ ...p, bad: e.target.checked }))} /> 臆病などの悪名
        </label>
        <button type="button" style={field} onClick={() => op({ op: 'reputation', level: Number(rep.level), deed: rep.deed, bad: rep.bad })}>
          保存
        </button>
        <span style={muted}>{REPUTATION_LEVELS[Number(rep.level)] ?? ''}</span>
      </div>
      <div style={row}>
        1d10
        <input aria-label="知名度の 1d10" type="number" min={1} max={10} value={die} onChange={(e) => setDie(e.target.value)} style={{ ...field, width: '44px' }} />
        <button type="button" style={field} onClick={() => op({ op: 'reputation_known', die: Number(die) })}>
          初めて会った相手が知っているか
        </button>
        相手の合計
        <input aria-label="威圧の相手の合計" type="number" value={their} onChange={(e) => setTheir(e.target.value)} style={{ ...field, width: '56px' }} />
        <button type="button" style={field} onClick={() => op({ op: 'facedown', roll: roll(), their_total: Number(their) })}>
          威圧（COOL + 知名度 + 1d10。出目は上の欄）
        </button>
      </div>
      {msg && <div style={{ fontSize: '0.8rem', color: 'var(--color-ally)' }}>{msg}</div>}
      {err && <div style={{ fontSize: '0.8rem', color: 'var(--color-danger)' }}>{err}</div>}
    </div>
  );
}
