import React from 'react';
import c from 'clsx';

interface Props {
  isActive: boolean;
}

const VoiceActivityIndicator: React.FC<Props> = ({ isActive }) => {
  return (
    <div className={c('voice-activity-indicator', { 'active': isActive })}>
      <div className="voice-activity-bar" />
      <div className="voice-activity-bar" />
      <div className="voice-activity-bar" />
    </div>
  );
};

export default VoiceActivityIndicator;