import { useEffect, useState } from 'react';
import {
  CharacterSheet,
  ROLES,
  roleRank,
  roleKeyOf,
  RoleExtra,
  SOLO_ABILITIES,
  SoloAbility,
  MAKER_SPECIALTIES,
  MakerSpecialty,
  CRAFT_TABLE,
  CRYO_BENEFITS,
  DRUGS,
  LOYALTY_CHANGES,
  execTeamSize,
  medicineSkills,
} from '@cyberpgm/shared';
import { gmFetch, api } from '../api.js';

interface Props {
  character: CharacterSheet;
  characters: CharacterSheet[];
  onChanged: () => void;
}

const field: React.CSSProperties = { padding: '4px 6px', fontSize: '0.8rem', borderRadius: '4px', border: '1px solid var(--color-border-light)', backgroundColor: 'var(--color-bg)', color: 'var(--color-text)' };
const row: React.CSSProperties = { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', fontSize: '0.8rem' };
const h: React.CSSProperties = { fontWeight: 700, fontSize: '0.85rem', marginTop: '6px' };
const muted: React.CSSProperties = { color: 'var(--color-text-muted)', fontSize: '0.75rem' };
const num = (v: string) => Number(v) || 0;

/**
 * ロール特技（Phase 5x。日本語版 p.142〜165）。ランク、ソロ・テク・メドテクの割り振り、ロールごとの判定・道具
 */
export function RolePanel({ character: ch, characters, onChanged }: Props) {
  const extra = (ch.extra ?? {}) as RoleExtra;
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ranks, setRanks] = useState<Record<string, string>>({});
  const [solo, setSolo] = useState<Record<string, string>>({});
  const [maker, setMaker] = useState<Record<string, string>>({});
  const [med, setMed] = useState<{ surgery: string; pharma: string; cryo: string; known: string[] }>({ surgery: '0', pharma: '0', cryo: '0', known: [] });
  const [r1, setR1] = useState('');
  const [r2, setR2] = useState('');
  const [opt, setOpt] = useState<Record<string, string>>({});
  const [jobs, setJobs] = useState<Array<{ key: string; name: string }>>([]);

  useEffect(() => {
    const rr: Record<string, string> = {};
    for (const r of ROLES) {
      const n = roleRank(ch.role, ch.extra, r.key);
      if (n > 0) rr[r.key] = String(n);
    }
    setRanks(rr);
    setSolo(Object.fromEntries(Object.entries(extra.solo_alloc ?? {}).map(([k, v]) => [k, String(v)])));
    setMaker(Object.fromEntries(Object.entries(extra.maker ?? {}).map(([k, v]) => [k, String(v)])));
    setMed({ surgery: String(extra.medicine?.surgery ?? 0), pharma: String(extra.medicine?.pharma ?? 0), cryo: String(extra.medicine?.cryo ?? 0), known: extra.medicine?.pharma_known ?? [] });
  }, [ch.id, ch.updated_at]);
  useEffect(() => {
    api.getRoleInfo().then((res: any) => setJobs(res.exec_team?.jobs ?? [])).catch(() => undefined);
  }, []);

  const send = async (path: string, body: unknown, method = 'POST') => {
    setErr(null);
    setMsg(null);
    const res = await gmFetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
    if (res.error) setErr(res.error);
    else {
      setMsg(res.formula ?? '反映しました');
      setR1('');
      setR2('');
      onChanged();
    }
  };
  const roll = () => (r1 ? { first: Number(r1), ...(r2 ? { extra: Number(r2) } : {}) } : undefined);
  const check = (kind: string, body: Record<string, unknown> = {}) => send(`/api/roles/${ch.id}/check`, { kind, roll: roll(), ...body });
  const rank = (r: string) => roleRank(ch.role, ch.extra, r);
  const rollInput = (
    <>
      出目
      <input aria-label="ロール特技の出目" type="number" min={1} max={10} value={r1} onChange={(e) => setR1(e.target.value)} style={{ ...field, width: '48px' }} />
      {(r1 === '10' || r1 === '1') && <input aria-label="追加の出目" type="number" min={1} max={10} value={r2} onChange={(e) => setR2(e.target.value)} style={{ ...field, width: '48px' }} placeholder="追加" />}
    </>
  );
  const o = (k: string, d = '') => opt[k] ?? d;
  const setO = (k: string, v: string) => setOpt((p) => ({ ...p, [k]: v }));

  return (
    <div data-testid="role-panel" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div style={row}>
        <span>ロール特技のランク:</span>
        {ROLES.filter((r) => ranks[r.key] !== undefined || roleKeyOf(ch.role) === r.key).map((r) => (
          <label key={r.key}>
            {r.nameJa}
            <input aria-label={`${r.nameJa} のランク`} type="number" min={0} max={10} value={ranks[r.key] ?? ''} onChange={(e) => setRanks((p) => ({ ...p, [r.key]: e.target.value }))} style={{ ...field, width: '44px', marginLeft: '2px' }} />
          </label>
        ))}
        <select aria-label="転職先のロール" value="" onChange={(e) => e.target.value && setRanks((p) => ({ ...p, [e.target.value]: '1' }))} style={field}>
          <option value="">転職（マルチクラス）を足す</option>
          {ROLES.filter((r) => ranks[r.key] === undefined && roleKeyOf(ch.role) !== r.key).map((r) => (
            <option key={r.key} value={r.key}>
              {r.nameJa}
            </option>
          ))}
        </select>
        <button type="button" style={field} onClick={() => send(`/api/roles/${ch.id}`, { role_ranks: Object.fromEntries(Object.entries(ranks).map(([k, v]) => [k, num(v)])) }, 'PUT')}>
          ランクを保存
        </button>
      </div>
      <div style={muted}>作成時はランク 4。転職は今のロールがランク 4 以上のとき、新しいロールをランク 1 から（p.143）</div>

      {rank('Solo') > 0 && (
        <>
          <div style={h}>ソロ《コンバット・アウェアネス》（ランク {rank('Solo')} ポイントを割り振る）</div>
          <div style={row}>
            {SOLO_ABILITIES.map((a) => (
              <label key={a.key} title={a.effect(num(solo[a.key] ?? '0'))}>
                {a.name}
                <input aria-label={a.name} type="number" min={0} max={a.max} step={a.step} value={solo[a.key] ?? ''} onChange={(e) => setSolo((p) => ({ ...p, [a.key]: e.target.value }))} style={{ ...field, width: '44px', marginLeft: '2px' }} />
              </label>
            ))}
            <button type="button" style={field} onClick={() => send(`/api/roles/${ch.id}`, { solo_alloc: Object.fromEntries(Object.entries(solo).map(([k, v]) => [k as SoloAbility, num(v)])) }, 'PUT')}>
              割り振りを保存
            </button>
          </div>
          <div style={muted}>{SOLO_ABILITIES.filter((a) => num(solo[a.key] ?? '0') > 0).map((a) => a.effect(num(solo[a.key] ?? '0'))).join(' / ') || '割り振りなし'}。戦闘中に変えるのはアクション 1 回（行動「コンバット・アウェアネスを割り振り直す」）</div>
        </>
      )}

      {rank('Tech') > 0 && (
        <>
          <div style={h}>テク《メイカー》（専門分野の合計はランク × 2 = {rank('Tech') * 2}）</div>
          <div style={row}>
            {(Object.keys(MAKER_SPECIALTIES) as MakerSpecialty[]).map((k) => (
              <label key={k}>
                {MAKER_SPECIALTIES[k]}
                <input aria-label={MAKER_SPECIALTIES[k]} type="number" min={0} max={10} value={maker[k] ?? ''} onChange={(e) => setMaker((p) => ({ ...p, [k]: e.target.value }))} style={{ ...field, width: '44px', marginLeft: '2px' }} />
              </label>
            ))}
            <button type="button" style={field} onClick={() => send(`/api/roles/${ch.id}`, { maker: Object.fromEntries(Object.entries(maker).map(([k, v]) => [k, num(v)])) }, 'PUT')}>
              保存
            </button>
          </div>
        </>
      )}
      <div style={h}>改造・作成・発明・修理（テクなら専門分野のランクを足す。p.136・148〜149）</div>
      <div style={row}>
        <select aria-label="作業" value={o('spec', 'repair')} onChange={(e) => setO('spec', e.target.value)} style={field}>
          <option value="repair">修理</option>
          {(Object.keys(MAKER_SPECIALTIES) as MakerSpecialty[]).map((k) => (
            <option key={k} value={k}>
              {MAKER_SPECIALTIES[k]}
              {k === 'field' ? '（応急修理）' : ''}
            </option>
          ))}
        </select>
        <select aria-label="価格等級" value={o('price', 'cheap')} onChange={(e) => setO('price', e.target.value)} style={field}>
          {CRAFT_TABLE.map((t) => (
            <option key={t.key} value={t.key}>
              {t.name}（難易度 {t.dv}、{t.time}）
            </option>
          ))}
        </select>
        <select aria-label="使う技術系技能" value={o('skill', 'basic_tech')} onChange={(e) => setO('skill', e.target.value)} style={field}>
          {['basic_tech', 'weaponstech', 'cybertech', 'electronics_security_tech', 'land_vehicle_tech', 'air_vehicle_tech', 'sea_vehicle_tech'].map((k) => (
            <option key={k} value={k}>
              {k === 'basic_tech' ? '基礎技術' : k === 'weaponstech' ? '武器技術' : k === 'cybertech' ? 'サイバー技術' : k === 'electronics_security_tech' ? '電子／保安技術' : k === 'land_vehicle_tech' ? '陸上ヴィークル技術' : k === 'air_vehicle_tech' ? '航空ヴィークル技術' : '海洋ヴィークル技術'}
            </option>
          ))}
        </select>
        {rollInput}
        <button type="button" style={field} onClick={() => check('tech_craft', { specialty: o('spec', 'repair'), price: o('price', 'cheap'), skill: o('skill', 'basic_tech'), field_repair: o('spec') === 'field' })}>
          判定
        </button>
      </div>

      {rank('Medtech') > 0 && (
        <>
          <div style={h}>メドテク《メディシン》（ランク {rank('Medtech')} ポイント）</div>
          <div style={row}>
            {(['surgery', 'pharma', 'cryo'] as const).map((k) => (
              <label key={k}>
                {k === 'surgery' ? '外科手術' : k === 'pharma' ? '医療技術（薬品）' : '医療技術（クリオ）'}
                <input aria-label={k} type="number" min={0} max={k === 'surgery' ? 10 : 5} value={med[k]} onChange={(e) => setMed((p) => ({ ...p, [k]: e.target.value }))} style={{ ...field, width: '44px', marginLeft: '2px' }} />
              </label>
            ))}
            <span style={muted}>
              → 〈外科手術〉{medicineSkills({ surgery: num(med.surgery) }).surgery}、〈医療技術〉{medicineSkills({ pharma: num(med.pharma), cryo: num(med.cryo) }).medical_tech}
            </span>
          </div>
          <div style={row}>
            使える薬品（{num(med.pharma)} 種類まで）:
            {DRUGS.filter((d) => d.medtechOnly).map((d) => (
              <label key={d.key}>
                <input type="checkbox" checked={med.known.includes(d.key)} onChange={(e) => setMed((p) => ({ ...p, known: e.target.checked ? [...p.known, d.key] : p.known.filter((x) => x !== d.key) }))} /> {d.name}
              </label>
            ))}
            <button type="button" style={field} onClick={() => send(`/api/roles/${ch.id}`, { medicine: { surgery: num(med.surgery), pharma: num(med.pharma), cryo: num(med.cryo), pharma_known: med.known } }, 'PUT')}>
              保存（技能も直す）
            </button>
          </div>
          {num(med.cryo) > 0 && <div style={muted}>クリオ: {CRYO_BENEFITS.slice(0, num(med.cryo)).join(' / ')}</div>}
          <div style={row}>
            薬品の調合（〈医療技術〉難易度 13、1 時間・200eb）:
            <select aria-label="調合する薬品" value={o('drug')} onChange={(e) => setO('drug', e.target.value)} style={field}>
              <option value="">選ぶ</option>
              {med.known.map((k) => (
                <option key={k} value={k}>
                  {DRUGS.find((d) => d.key === k)?.name}
                </option>
              ))}
            </select>
            {rollInput}
            <button type="button" style={field} onClick={() => check('medtech_pharma', { drug: o('drug') })}>
              調合
            </button>
          </div>
        </>
      )}

      {rank('Rockerboy') > 0 && (
        <>
          <div style={h}>ロッカーボーイ《カリズマティック・インパクト》（ランク {rank('Rockerboy')}）</div>
          <div style={row}>
            <select aria-label="ファンの人数" value={o('size', 'one')} onChange={(e) => setO('size', e.target.value)} style={field}>
              <option value="one">1 人（難易度 8）</option>
              <option value="small">6 人以下（10）</option>
              <option value="large">多人数（12）</option>
            </select>
            {rollInput}
            <button type="button" style={field} onClick={() => check('rockerboy', { size: o('size', 'one') })}>
              判定（ランク + 1d10）
            </button>
          </div>
        </>
      )}

      {rank('Media') > 0 && (
        <>
          <div style={h}>メディア《クレディビリティ》（ランク {rank('Media')}）</div>
          <div style={row}>
            {rollInput}
            <button type="button" style={field} onClick={() => check('media_passive')}>
              受動的な噂（GM が週 2 回）
            </button>
            証拠の数
            <input aria-label="裏付けのある証拠の数" type="number" min={0} value={o('evidence', '0')} onChange={(e) => setO('evidence', e.target.value)} style={{ ...field, width: '44px' }} />
            <button type="button" style={field} onClick={() => check('media_believe', { evidence: num(o('evidence', '0')) })}>
              報道を信じてもらえるか（1d10）
            </button>
          </div>
        </>
      )}

      {rank('Fixer') > 0 && (
        <>
          <div style={h}>フィクサー《オペレーター》（ランク {rank('Fixer')}）</div>
          <div style={row}>
            {rollInput}
            相手の合計
            <input aria-label="相手の合計" type="number" value={o('their')} onChange={(e) => setO('their', e.target.value)} style={{ ...field, width: '56px' }} />
            <button type="button" style={field} onClick={() => check('fixer_haggle', { their_total: num(o('their')) })}>
              値切り（COOL + 売買 + ランク + 1d10）
            </button>
          </div>
        </>
      )}

      {rank('Exec') > 0 && (
        <>
          <div style={h}>
            エグゼク《チームワーク》（ランク {rank('Exec')}、チーム・メンバー {execTeamSize(rank('Exec'))} 人まで）
          </div>
          {(extra.exec_team ?? []).map((m, i) => (
            <div key={m.character_id} style={row}>
              <span>
                {characters.find((c) => c.id === m.character_id)?.name ?? m.job}（{m.job}）忠誠度 <b>{m.loyalty}</b>
              </span>
              <select aria-label="忠誠度の変化" value="" onChange={(e) => {
                const ch2 = LOYALTY_CHANGES[Number(e.target.value)];
                if (ch2) check('exec_loyalty', { index: i, delta: ch2.delta, reason: ch2.label });
              }} style={field}>
                <option value="">忠誠度を変える</option>
                {LOYALTY_CHANGES.map((l, j) => (
                  <option key={j} value={j}>
                    {l.delta > 0 ? `+${l.delta}` : l.delta} {l.label}
                  </option>
                ))}
              </select>
              1d6
              <input aria-label="忠誠度判定の 1d6" type="number" min={1} max={6} value={o(`die${i}`)} onChange={(e) => setO(`die${i}`, e.target.value)} style={{ ...field, width: '44px' }} />
              <button type="button" style={field} onClick={() => check('exec_loyalty', { index: i, die: num(o(`die${i}`)) })}>
                忠誠度判定
              </button>
            </div>
          ))}
          {(extra.exec_team ?? []).length < execTeamSize(rank('Exec')) && (
            <div style={row}>
              <select aria-label="職務" value={o('job')} onChange={(e) => setO('job', e.target.value)} style={field}>
                <option value="">職務を選ぶ</option>
                {jobs.map((j) => (
                  <option key={j.key} value={j.key}>
                    {j.name}
                  </option>
                ))}
              </select>
              能力値の 1d6
              <input aria-label="能力値の 1d6" type="number" min={1} max={6} value={o('sdie')} onChange={(e) => setO('sdie', e.target.value)} style={{ ...field, width: '44px' }} />
              忠誠度の 1d6
              <input aria-label="忠誠度の 1d6" type="number" min={1} max={6} value={o('ldie')} onChange={(e) => setO('ldie', e.target.value)} style={{ ...field, width: '44px' }} />
              <button type="button" style={field} onClick={() => check('exec_recruit', { job: o('job'), stat_die: num(o('sdie')), loyalty_die: num(o('ldie')) })}>
                チーム・メンバーを作る
              </button>
            </div>
          )}
        </>
      )}

      {rank('Lawman') > 0 && <div style={muted}>ローマン《バックアップ》: 戦闘の行動「支援を呼ぶ」で 1d10（ランク {rank('Lawman')} 以下で応じる）と到着の 1d6。来たら戦闘画面の「支援要員を入れる」</div>}
      {rank('Nomad') > 0 && <div style={muted}>ノーマッド《モト》: ヴィークルの運転・操縦・技術の判定に +{rank('Nomad')}（自動）。家族のヴィークルとアップグレードはロールの説明を参照</div>}
      {rank('Netrunner') > 0 && <div style={muted}>ネットランナー《インターフェイス》: 1 ターンの NET アクション {rank('Netrunner') >= 10 ? 5 : rank('Netrunner') >= 7 ? 4 : rank('Netrunner') >= 4 ? 3 : 2} 回</div>}
      {msg && <div style={{ fontSize: '0.8rem', color: 'var(--color-ally)' }}>{msg}</div>}
      {err && <div style={{ fontSize: '0.8rem', color: 'var(--color-danger)' }}>{err}</div>}
    </div>
  );
}
