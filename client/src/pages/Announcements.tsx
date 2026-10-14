import React from 'react';
import { PageHeader } from '../components/ui';
import { usePageTour } from '../lib/tour';
export default function Announcements() {
  usePageTour('Announcements', []);
  return <PageHeader title="Announcements" subtitle="Coming soon" />;
}
