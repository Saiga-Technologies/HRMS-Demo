import React from 'react';
import { PageHeader } from '../components/ui';
import { usePageTour } from '../lib/tour';
export default function OrgTree() {
  usePageTour('OrgTree', []);
  return <PageHeader title="OrgTree" subtitle="Coming soon" />;
}
