import React from 'react';
import { PageHeader } from '../components/ui';
import { usePageTour } from '../lib/tour';
export default function Leave() {
  usePageTour('Leave', []);
  return <PageHeader title="Leave" subtitle="Coming soon" />;
}
