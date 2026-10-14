import React from 'react';
import { PageHeader } from '../components/ui';
import { usePageTour } from '../lib/tour';
export default function Letters() {
  usePageTour('Letters', []);
  return <PageHeader title="Letters" subtitle="Coming soon" />;
}
