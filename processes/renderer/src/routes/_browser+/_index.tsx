import { FolderOpen, Image as ImageIcon } from 'lucide-react';
import { useFetcher } from 'react-router';

export default function Welcome() {
  const open = useFetcher({ key: 'open-library' });
  const opening = open.state !== 'idle';
  return (
    <div className="welcome">
      <div className="welcome-icon">
        <ImageIcon size={42} strokeWidth={1} />
      </div>
      <span className="eyebrow">YOUR PHOTOS, WHERE THEY ARE</span>
      <h1>A fresh perspective.</h1>
      <p>
        Open a folder and make yourself at home.
        <br />
        Your collection stays right where you left it.
      </p>
      <open.Form method="post" action="/library">
        <button type="submit" className="primary-button" disabled={opening}>
          <FolderOpen size={16} />
          {opening ? 'Opening…' : 'Choose a folder'}
        </button>
      </open.Form>
      <span className="welcome-note">No imports. No library to maintain.</span>
    </div>
  );
}
