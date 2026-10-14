import React from 'react';
import { PageHeader } from '../components/ui';
import { usePageTour } from '../lib/tour';
export default function Performance() {
  usePageTour('Performance', []);
  return <PageHeader title="Performance" subtitle="Coming soon" />;
}
