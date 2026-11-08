import { Card, CardBody, CardHeader } from '@nextui-org/card'

export default function CapabilityUnavailable({
  title,
  reason
}: {
  title: string
  reason: string
}) {
  return (
    <div className="p-4">
      <Card className="bg-opacity-60 backdrop-blur-sm">
        <CardHeader>
          <h1 className="text-xl font-bold">{title}</h1>
        </CardHeader>
        <CardBody className="text-default-600 dark:text-default-300">
          {reason}
        </CardBody>
      </Card>
    </div>
  )
}
