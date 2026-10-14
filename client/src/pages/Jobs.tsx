import React from 'react';
import { PageHeader } from '../components/ui';
import { usePageTour } from '../lib/tour';
export default function Jobs() {
  usePageTour('Jobs', []);
  return <PageHeader title="Jobs" subtitle="Coming soon" />;
}
