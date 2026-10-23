import { useEffect, useState } from 'react';
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

export function LoreView({ request }: { request: { id: string } | null }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [data, setData] = useState<LoreData & { hasSource: boolean } | null>(null);
  const [catalog, setCatalog] = useState<LoreEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(request?.id ?? null);
  const [error, setError] = useState('');
  const [copyMessage, setCopyMessage] = useState('');

  useEffect(() => {
    if (!request) return;
    setQuery('');
    setCategory('');
    setSelectedId(request.id);
    setCopyMessage('');
  }, [request]);

  useEffect(() => {
    const controller = new AbortController();
    setError('');
    gmFetch(`/api/lore?${new URLSearchParams({ q: query, category })}`, { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error('資料を読み込めませんでした');
        return r.json();
      })
      .then((result) => {
        if (controller.signal.aborted) return;
        setData(result);
        if (!query && !category) setCatalog(result.entries);
        setSelectedId((id) => id ?? result.entries[0]?.id ?? null);
      })
      .catch((err: Error) => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [query, category]);

  const selected = catalog.find((e) => e.id === selectedId) ?? data?.entries.find((e) => e.id === selectedId);
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
      <h2>資料</h2>
      <div className="lore-filters">
        <input aria-label="資料を検索" placeholder="資料を検索（空白で複数語）" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select aria-label="資料の分類" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">すべて</option>
          {Object.entries(data?.categories ?? {}).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
      </div>
      {error && <p role="alert">{error}</p>}
      {!data && !error && <p>読み込み中…</p>}
      {data && !data.hasSource ? <p>世界観の資料（手元のルール資料）がありません</p> : data && (
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
                return related ? <button key={id} type="button" onClick={() => { setQuery(''); setCategory(''); open(id); }}>{related.title}</button> : <span key={id} className="lore-muted">{id}（資料未追加）</span>;
              })}</div>}
              <p className="lore-muted">参照: 日本語版 p.{selected.pages.join(', ')}</p>
            </> : <p>一覧から資料を選んでください</p>}
          </article>
        </div>
      )}
    </section>
  );
}
