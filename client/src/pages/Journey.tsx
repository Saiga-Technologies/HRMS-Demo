import React from 'react';
import { PageHeader } from '../components/ui';
import { usePageTour } from '../lib/tour';
export default function Journey() {
  usePageTour('Journey', []);
  return <PageHeader title="Journey" subtitle="Coming soon" />;
}
