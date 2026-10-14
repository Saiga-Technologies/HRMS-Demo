import React from 'react';
import { PageHeader } from '../components/ui';
import { usePageTour } from '../lib/tour';
export default function Clients() {
  usePageTour('Clients', []);
  return <PageHeader title="Clients" subtitle="Coming soon" />;
}
