import { lazy, Suspense } from 'react';
import { AppLoading } from '../components/AppLoading';
import { PageBackAction, PageContainer, PageHeader } from '../components/PageHeader';
import { useSiteSettingsQuery } from '../site/site-settings';
import { Skeleton } from '../ui/antd';
import { Button } from '../ui/buttons';
import { Alert } from '../ui/feedback';
import { Stack } from '../ui/primitives';

const Experience = lazy(() => import('./MingLibraryExperience').then(module => ({default: module.MingLibraryExperience})));

export function VirtualLibraryRoute() {
  const query = useSiteSettingsQuery(true);
  // 每次进入都确认开关；Revalidate on entry, including when cached or offline.
  const verified = query.isSuccess && query.isFetchedAfterMount;

  if (query.isError) return <PageContainer><PageBackAction to="/library">返回藏书楼</PageBackAction><Stack spacing={2}>
    <Alert severity="error">暂时无法确认 3D 书库是否已开启。</Alert>
    <Button onClick={() => void query.refetch()}>重试</Button>
  </Stack></PageContainer>;
  if (!verified || !query.data) return <PageContainer><PageBackAction to="/library">返回藏书楼</PageBackAction><div role="status" aria-label="正在检查 3D 书库状态"><Skeleton active /></div></PageContainer>;
  if (!query.data.virtualLibraryEnabled) return <PageContainer>
    <PageHeader back={<PageBackAction inline to="/library">返回藏书楼</PageBackAction>} title="3D 书库未启用" />
  </PageContainer>;
  return <Suspense fallback={<AppLoading label="正在进入 3D 书库…" />}><Experience /></Suspense>;
}
