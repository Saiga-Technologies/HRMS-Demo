import React from 'react';
import { PageHeader } from '../components/ui';
import { usePageTour } from '../lib/tour';
export default function Assets() {
  usePageTour('Assets', []);
  return <PageHeader title="Assets" subtitle="Coming soon" />;
}
