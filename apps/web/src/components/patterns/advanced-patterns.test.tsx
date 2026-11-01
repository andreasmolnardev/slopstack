import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { calculateVirtualWindow, CollectionView, CommentThread, DashboardWidget, EmptyState, InfiniteFeed, LoadingState } from './advanced-patterns';
import { DetailLayout, FeedLayout, MasterDetailLayout } from './application-layouts';

describe('application presentation patterns', () => {
  it('renders reusable empty, loading, widget, and collection states', () => {
    const markup = renderToStaticMarkup(<div>
      <EmptyState title="No entries" description="Create one to start." />
      <LoadingState rows={2} />
      <DashboardWidget title="Summary"><p>Two items</p></DashboardWidget>
      <CollectionView items={[{ id: '1', group: 'Today', label: 'Do work' }]} getKey={(item) => item.id} groupBy={(item) => item.group} renderItem={(item) => <span>{item.label}</span>} />
    </div>);
    expect(markup).toContain('No entries');
    expect(markup).toContain('aria-label="Loading"');
    expect(markup).toContain('Summary');
    expect(markup).toContain('Today');
    expect(markup).toContain('Do work');
  });

  it('renders threaded comments and an accessible feed continuation control', () => {
    const markup = renderToStaticMarkup(<div>
      <CommentThread comments={[{ id: 'root', author: 'Sam', body: 'A note' }, { id: 'reply', author: 'Alex', body: 'A reply', parentId: 'root' }]} onSubmit={() => undefined} />
      <InfiniteFeed items={['one']} getKey={(item) => item} renderItem={(item) => item} hasMore loading={false} onLoadMore={() => undefined} />
    </div>);
    expect(markup).toContain('A note');
    expect(markup).toContain('A reply');
    expect(markup).toContain('Load more');
  });

  it('calculates an overscanned window for fixed-height feeds', () => {
    expect(calculateVirtualWindow(1000, 500, { height: 200, itemHeight: 50, overscan: 2 })).toEqual({
      start: 8, end: 16, totalHeight: 50000,
    });
  });

  it('renders composable content layouts', () => {
    const markup = renderToStaticMarkup(<div>
      <DetailLayout main={<p>Details</p>} aside={<p>Related</p>} />
      <FeedLayout columns="two"><p>Feed</p></FeedLayout>
      <MasterDetailLayout master={<p>Items</p>} detail={<p>Selection</p>} />
    </div>);
    expect(markup).toContain('Related information');
    expect(markup).toContain('Feed');
    expect(markup).toContain('Selection');
  });
});
