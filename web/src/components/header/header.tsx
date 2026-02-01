import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import './header.css';
import { Atom as XenonLogo } from 'lucide-react';
import { getEnabledNavItems } from '../../config/navigation';

const Header: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const navItems = getEnabledNavItems();

  const isActive = (path: string) => location.pathname === path;

  return (
    <div className="header-container">
      <div className="header-logo-container">
        <XenonLogo size={45} className="header-logo-image" />
        <div className="header-logo">Xenon</div>
      </div>
      <div className="header-nav">
        {navItems.map((item) => (
          <button
            key={item.id}
            className={`header-nav__item ${isActive(item.path) ? 'active' : ''}`}
            onClick={() => navigate(item.path)}
          >
            <span className="header-nav__icon">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
};

export default Header;
