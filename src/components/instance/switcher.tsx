import { Button } from '@nextui-org/button'
import { Select, SelectItem } from '@nextui-org/select'
import { IoAdd } from 'react-icons/io5'
import { useNavigate } from 'react-router-dom'

import useInstance from '@/hooks/use-instance'

import { managementLabels, protocolLabels } from '@/types/instance'

export default function InstanceSwitcher() {
  const { instances, instance, selectInstance } = useInstance()
  const navigate = useNavigate()

  return (
    <div className="flex flex-col gap-2 px-4 pt-3 pb-4">
      <div className="flex items-center gap-2">
        <Select
          aria-label="选择适配器实例"
          classNames={{
            trigger:
              'bg-default-100 dark:bg-default-50 border border-default-200'
          }}
          label="当前实例"
          selectedKeys={instance ? [instance.id] : []}
          size="sm"
          onSelectionChange={(keys) => {
            const nextId = Array.from(keys)[0]
            if (typeof nextId === 'string') selectInstance(nextId)
          }}
        >
          {instances.length > 0 ? (
            instances.map((item) => (
              <SelectItem key={item.id} textValue={item.name}>
                {item.name}
              </SelectItem>
            ))
          ) : (
            <SelectItem key="empty" textValue="无实例">
              尚未登记实例
            </SelectItem>
          )}
        </Select>
        <Button
          isIconOnly
          aria-label="管理实例"
          color="primary"
          radius="full"
          size="sm"
          variant="flat"
          onPress={() => navigate('/instances')}
        >
          <IoAdd />
        </Button>
      </div>
      {instance && (
        <div className="px-1 text-xs text-default-500">
          {protocolLabels[instance.protocol]} ·{' '}
          {managementLabels[instance.managementKind]}
        </div>
      )}
    </div>
  )
}
