import React from 'react';
import { Smartphone, Hammer, AppWindow, Bell, Settings } from 'lucide-react';

export interface NavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  path: string;
  enabled: boolean; // Set to false to hide menu items during development
}

/**
 * Navigation menu configuration
 * Add new menu items here as features are developed
 */
export const navigationConfig: NavItem[] = [
  {
    id: 'devices',
    label: 'Devices',
    icon: <Smartphone size={18} color="currentColor" />,
    path: '/devices',
    enabled: true,
  },
  {
    id: 'builds',
    label: 'Builds',
    icon: <Hammer size={18} color="currentColor" />,
    path: '/builds',
    enabled: true,
  },
  {
    id: 'apps',
    label: 'Apps',
    icon: <AppWindow size={18} color="currentColor" />,
    path: '/apps',
    enabled: true,
  },
  {
    id: 'notifications',
    label: 'Notifications',
    icon: <Bell size={18} color="currentColor" />,
    path: '/notifications',
    enabled: true,
  },
  // {
  //   id: 'stats',
  //   label: 'Statistics',
  //   icon: <BarChart3 size={18} />,
  //   path: '/stats',
  //   enabled: false,
  // },
  {
    id: 'settings',
    label: 'Settings',
    icon: <Settings size={18} color="currentColor" />,
    path: '/settings',
    enabled: false,
  },
];

/**
 * Get only enabled navigation items
 */
export const getEnabledNavItems = (): NavItem[] => {
  return navigationConfig.filter((item) => item.enabled);
};
