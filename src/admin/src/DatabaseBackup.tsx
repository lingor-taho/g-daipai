import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Space,
  Table,
  Typography,
  message
} from 'antd';
import { DatabaseOutlined, DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import { authHeaders, fetchAdminJson, getAdminHttpErrorMessage } from './utils/auth';

function formatBytes(value: number | null | undefined) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}`;
}

async function createBackup() {
  const res = await fetch('/api/admin/data-cleanup/db-backups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(getAdminHttpErrorMessage(res.status, data, '生成数据库快照失败'));
  return data;
}

async function downloadBackup(fileName: string, downloadUrl: string) {
  const res = await fetch(downloadUrl, { headers: authHeaders() });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(getAdminHttpErrorMessage(res.status, data, '下载数据库快照失败'));
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function DatabaseBackupPage() {
  const [info, setInfo] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [downloadingFile, setDownloadingFile] = useState('');

  async function fetchInfo() {
    setLoading(true);
    try {
      const data = await fetchAdminJson('/api/admin/data-cleanup/db-backups');
      setInfo(data);
    } catch (e: any) {
      message.error(e.message || '数据库备份信息加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchInfo();
  }, []);

  async function handleCreateAndDownload() {
    setCreating(true);
    try {
      const backup = await createBackup();
      await downloadBackup(backup.fileName, backup.downloadUrl);
      message.success(`已生成并下载 ${backup.fileName}`);
      await fetchInfo();
    } catch (e: any) {
      message.error(e.message || '生成数据库快照失败');
    } finally {
      setCreating(false);
    }
  }

  async function handleDownload(record: any) {
    setDownloadingFile(record.fileName);
    try {
      await downloadBackup(
        record.fileName,
        `/api/admin/data-cleanup/db-backups/${encodeURIComponent(record.fileName)}/download`
      );
    } catch (e: any) {
      message.error(e.message || '下载数据库快照失败');
    } finally {
      setDownloadingFile('');
    }
  }

  const backups = Array.isArray(info?.backups) ? info.backups : [];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Typography.Title level={3} style={{ margin: 0 }}>服务器数据库下载</Typography.Title>

      <Alert
        type="info"
        showIcon
        message="生成快照后再下载，不直接读取正在运行的原数据库文件。"
        description="生成期间数据库仍可正常读写；下载的是当时生成出来的独立 db 文件。系统每周一 04:00 自动清理旧快照。"
      />

      <Card
        title="当前数据库"
        extra={
          <Button icon={<ReloadOutlined />} onClick={fetchInfo} loading={loading}>
            刷新
          </Button>
        }
      >
        <Descriptions bordered column={1} size="small">
          <Descriptions.Item label="数据库地址">{info?.displayDatabasePath || '-'}</Descriptions.Item>
          <Descriptions.Item label="快照保存目录">{info?.displayBackupDir || '-'}</Descriptions.Item>
          <Descriptions.Item label="自动清理">{info?.cleanupSchedule || '-'}</Descriptions.Item>
        </Descriptions>
        <Button
          type="primary"
          icon={<DatabaseOutlined />}
          style={{ marginTop: 16 }}
          loading={creating}
          onClick={handleCreateAndDownload}
        >
          生成数据库快照并下载
        </Button>
      </Card>

      <Card title="已生成快照">
        <Table
          rowKey="fileName"
          loading={loading}
          dataSource={backups}
          pagination={{ pageSize: 10 }}
          columns={[
            { title: '文件名', dataIndex: 'fileName' },
            { title: '大小', dataIndex: 'sizeBytes', render: formatBytes, width: 120 },
            { title: '生成时间', dataIndex: 'createdAt', render: formatDateTime, width: 190 },
            {
              title: '操作',
              width: 120,
              render: (_: any, record: any) => (
                <Button
                  size="small"
                  icon={<DownloadOutlined />}
                  loading={downloadingFile === record.fileName}
                  onClick={() => handleDownload(record)}
                >
                  下载
                </Button>
              )
            }
          ]}
        />
      </Card>
    </Space>
  );
}
