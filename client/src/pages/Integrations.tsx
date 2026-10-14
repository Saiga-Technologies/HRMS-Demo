import React from 'react';
import { PageHeader } from '../components/ui';
import { usePageTour } from '../lib/tour';
export default function Integrations() {
  usePageTour('Integrations', []);
  return <PageHeader title="Integrations" subtitle="Coming soon" />;
}
