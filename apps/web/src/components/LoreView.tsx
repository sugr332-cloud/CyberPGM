import { useEffect, useMemo, useState, useRef } from 'react';
import { loreSearchTerms, normalizeLoreText, type LoreEntry, type LoreData } from '@cyberpgm/shared';
import { gmFetch } from '../api.js';
import './LoreView.css';

/** 正規化後の一致位置を元の文字に戻し、全角英数字も元の表記で強調する。 */
function Highlight({ text, query }: { text: string; query: string }) {
  const chars = Array.from(text);
  const normalized = chars.map(normalizeLoreText);
  const searchable = normalized.join('');
  const matched = new Set<number>();
  for (const term of loreSearchTerms(query)) {
    let offset = searchable.indexOf(term);
    while (offset >= 0) {
      for (let i = offset; i < offset + term.length; i++) matched.add(i);
      offset = searchable.indexOf(term, offset + 1);
    }
  }
  let offset = 0;
  const segments: Array<{ text: string; marked: boolean }> = [];
  chars.forEach((char, i) => {
    const marked = Array.from({ length: normalized[i].length }, (_, n) => matched.has(offset + n)).some(Boolean);
    offset += normalized[i].length;
    const last = segments.at(-1);
    if (last?.marked === marked) last.text += char;
    else segments.push({ text: char, marked });
  });
  return <>{segments.map((s, i) => s.marked ? <mark key={i}>{s.text}</mark> : s.text)}</>;
}

export function LoreView({ request, playerToken }: { request: { id: string } | null; playerToken?: string | null }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [data, setData] = useState<LoreData & { hasSource: boolean } | null>(null);
  const [catalog, setCatalog] = useState<LoreEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(request?.id ?? null);
  const [error, setError] = useState('');
  const [copyMessage, setCopyMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const pendingRequest = useRef<string | null>(request?.id ?? null);

  useEffect(() => {
    if (!request) return;
    pendingRequest.current = request.id;
    setQuery('');
    setCategory('');
    setSelectedId(request.id);
    setCopyMessage('');
  }, [request]);

  useEffect(() => {
    const controller = new AbortController();
    setError('');
    setLoading(true);
    (playerToken
      ? fetch(`/api/lore?${new URLSearchParams({ q: query, category })}`, { signal: controller.signal, headers: { Authorization: `Bearer ${playerToken}` } })
      : gmFetch(`/api/lore?${new URLSearchParams({ q: query, category })}`, { signal: controller.signal }))
      .then(async (r) => {
        if (!r.ok) throw new Error('資料を読み込めませんでした');
        return r.json();
      })
      .then((result) => {
        if (controller.signal.aborted) return;
        setData(result);
        if (!query && !category) setCatalog(result.entries);
        setSelectedId((id) => result.entries.some((e: LoreEntry) => e.id === id) ? id : (category || query.trim() ? result.entries[0]?.id ?? null : null));
        // 検索などから直接開いた場合も、その項目のジャンルに入る。
        if (!query && !category && pendingRequest.current) {
          const entry = result.entries.find((e: LoreEntry) => e.id === pendingRequest.current);
          pendingRequest.current = null;
          if (entry) setCategory(entry.category);
        }
      })
      .catch((err: Error) => { if (!controller.signal.aborted) setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query, category, request, playerToken]);

  const selected = data?.entries.find((e) => e.id === selectedId);
  const genres = useMemo(() => {
    const categories = { ...data?.categories };
    for (const entry of catalog) if (!categories[entry.category]) categories[entry.category] = entry.category;
    const order = ['timeline', 'corp', 'world', 'nightcity', 'life', 'gm', 'flavor'];
    return Object.entries(categories).sort(([a], [b]) => (order.indexOf(a) < 0 ? 99 : order.indexOf(a)) - (order.indexOf(b) < 0 ? 99 : order.indexOf(b)));
  }, [data?.categories, catalog]);
  const descriptions: Record<string, string> = {
    timeline: '年代順に出来事をたどる', corp: '企業・組織とその背景を調べる', world: '歴史や社会、レッドの時代を知る',
    nightcity: '街の地区や施設、勢力を調べる', life: '衣食住や仕事、街での暮らしを知る', gm: 'セッションを進めるための資料', flavor: '描写や雰囲気づくりのヒント',
  };
  const isBrowsing = !!(category || query.trim() || selectedId);
  const enterGenre = (id: string) => { setQuery(''); setCategory(id); setSelectedId(null); setCopyMessage(''); };
  const goHome = () => { pendingRequest.current = null; setQuery(''); setCategory(''); setSelectedId(null); setCopyMessage(''); };
  const highlight = (text: string) => <Highlight text={text} query={query} />;
  const open = (id: string) => { setSelectedId(id); setCopyMessage(''); };
  const copy = async () => {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText([selected.summary, ...selected.body.map((line) => `・${line}`)].join('\n'));
      setCopyMessage('コピーしました');
    } catch {
      setCopyMessage('コピーできませんでした');
    }
  };

  return (
    <section className="lore-view" data-testid="lore-view" aria-label="世界観の資料">
      <div className="lore-heading">
        <h2>資料{category ? ` / ${data?.categories?.[category] ?? category}` : query.trim() ? ' / 検索結果' : ''}</h2>
        {isBrowsing && <button type="button" onClick={goHome}>ジャンル一覧に戻る</button>}
      </div>
      {!isBrowsing && <p className="lore-intro">調べたいジャンルを選んでください。</p>}
      <div className="lore-filters">
        <input aria-label="資料を検索" placeholder={category ? "このジャンルを検索（空白で複数語）" : "全ジャンルから検索（空白で複数語）"} value={query} onChange={(e) => { setQuery(e.target.value); setSelectedId(null); }} />
        <select aria-label="資料の分類" value={category} onChange={(e) => enterGenre(e.target.value)}>
          <option value="">ジャンルを選択</option>
          {Object.entries(data?.categories ?? {}).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
      </div>
      {error && <p role="alert">{error}</p>}
      {loading && !error && <p role="status">読み込み中…</p>}
      {data && !data.hasSource ? <p>世界観の資料（手元のルール資料）がありません</p> : data && !loading && !isBrowsing ? (
        <div className="lore-genres" data-testid="lore-genres" aria-label="資料のジャンル">
          {genres.map(([id, name]) => <button key={id} type="button" data-testid={`lore-genre-${id}`} onClick={() => enterGenre(id)}>
            <strong>{name}</strong><span>{descriptions[id] || `${name}の資料を調べる`}</span>
            <small>{catalog.filter((e) => e.category === id).length} 件の資料 →</small>
          </button>)}
        </div>
      ) : data && !loading && isBrowsing && (
        <div className="lore-columns">
          <div className="lore-list" aria-label="資料の一覧">
            <p className="lore-muted">{data.entries.length} 件</p>
            {data.entries.length === 0 && <p>該当する資料がありません</p>}
            {data.entries.map((entry) => (
              <button key={entry.id} type="button" aria-pressed={entry.id === selectedId} onClick={() => open(entry.id)}>
                {entry.year && <strong className="lore-year">{highlight(entry.year)}</strong>}
                <strong>{highlight(entry.title)}</strong>
                <span className="lore-muted">{data.categories?.[entry.category] ?? entry.category} · p.{entry.pages.join(', ')}</span>
              </button>
            ))}
          </div>
          <article className="lore-detail" data-testid="lore-detail">
            {selected ? <>
              <div className="lore-detail-heading">
                <h3>{selected.year && <span className="lore-year">{highlight(selected.year)} </span>}{highlight(selected.title)}</h3>
                <button type="button" onClick={copy}>コピー</button>
              </div>
              <p role="status">{copyMessage}</p>
              <p className="lore-summary">{highlight(selected.summary)}</p>
              <ul>{selected.body.map((line, i) => <li key={i}>{highlight(line)}</li>)}</ul>
              <div className="lore-tags">{selected.tags.map((tag) => <span key={tag}>{highlight(tag)}</span>)}</div>
              {!!selected.related?.length && <div className="lore-related"><h4>関連項目</h4>{selected.related.map((id) => {
                const related = catalog.find((entry) => entry.id === id);
                return related ? <button key={id} type="button" onClick={() => { setQuery(''); setCategory(related.category); open(id); }}>{related.title}</button> : <span key={id} className="lore-muted">{id}（資料未追加）</span>;
              })}</div>}
              <p className="lore-muted">参照: 日本語版 p.{selected.pages.join(', ')}</p>
            </> : <p>一覧から資料を選んでください</p>}
          </article>
        </div>
      )}
    </section>
  );
}
