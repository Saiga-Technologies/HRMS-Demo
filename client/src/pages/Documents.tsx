import React from 'react';
import { PageHeader } from '../components/ui';
import { usePageTour } from '../lib/tour';
export default function Documents() {
  usePageTour('Documents', []);
  return <PageHeader title="Documents" subtitle="Coming soon" />;
}
