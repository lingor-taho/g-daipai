import { colors } from '../styles';

export default function UserFooter() {
  return (
    <div
      style={{
        margin: '28px 0 10px',
        paddingTop: 12,
        borderTop: `1px solid ${colors.border}`,
        textAlign: 'center',
        color: colors.faint,
        fontSize: 12
      }}
    >
      © 2026 Kumohiro Co., Ltd.
    </div>
  );
}
