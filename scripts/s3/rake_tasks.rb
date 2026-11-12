# Shared Rake plumbing for mounting the MinIO bucket belonging to the current
# application profile. The shell helper owns URL parsing and FUSE lifecycle;
# this file only loads the profile and forwards the two task arguments.

require 'uri'

def register_s3_tasks(profile_resolver:, profile_loader:, base_dir:, bucket_resolver: nil)
    mount_script = begin
        user_script = File.expand_path('~/scripts/s3/mount-minio.sh')
        File.file?(user_script) ? user_script : File.expand_path('scripts/s3/mount-minio.sh', base_dir)
    end

    desc 'Mount the current profile MinIO bucket in the background (rake "s3mount[profile,mount-point,bucket]")'
    task :s3mount, [:profile, :mountpoint, :bucket] do |_task, args|
        profile = profile_resolver.call(args)
        profile_loader.call(profile)
        minio_url = ENV['MINIO_URL'].to_s.strip
        credentials = ENV['MINIO_CREDS'].to_s.strip
        bucket = args[:bucket].to_s.strip
        bucket = bucket_resolver.call(args) if bucket.empty? && bucket_resolver
        if !bucket.empty? && URI.parse(minio_url).path.to_s.split('/').reject(&:empty?).empty?
            minio_url = "#{minio_url.sub(%r{/$}, '')}/#{bucket}"
        end
        abort "Missing MINIO_URL in profile #{profile}" if minio_url.empty?
        abort "Missing MINIO_CREDS in profile #{profile}" if credentials.empty?
        abort "MinIO mount helper not found: #{mount_script}" unless File.file?(mount_script)

        mountpoint = args[:mountpoint].to_s.strip
        mountpoint = ENV['S3_MOUNT_POINT'].to_s.strip if mountpoint.empty?
        command = ['bash', mount_script, minio_url]
        command << mountpoint unless mountpoint.empty?
        # MINIO_CREDS is inherited from the loaded profile and never appears
        # in the command line. Set S3_MOUNT_FOREGROUND=1 for a blocking mount.
        background = ENV['S3_MOUNT_FOREGROUND'].to_s != '1'
        sh({ 'S3_MOUNT_BACKGROUND' => background ? '1' : '0' }, *command)
    end

    desc 'Unmount the current profile MinIO bucket (rake "s3unmount[profile,mount-point,bucket]")'
    task :s3unmount, [:profile, :mountpoint, :bucket] do |_task, args|
        profile = profile_resolver.call(args)
        profile_loader.call(profile)
        minio_url = ENV['MINIO_URL'].to_s.strip
        bucket = args[:bucket].to_s.strip
        bucket = bucket_resolver.call(args) if bucket.empty? && bucket_resolver
        if !bucket.empty? && URI.parse(minio_url).path.to_s.split('/').reject(&:empty?).empty?
            minio_url = "#{minio_url.sub(%r{/$}, '')}/#{bucket}"
        end
        abort "Missing MINIO_URL in profile #{profile}" if minio_url.empty?
        abort "MinIO mount helper not found: #{mount_script}" unless File.file?(mount_script)

        mountpoint = args[:mountpoint].to_s.strip
        mountpoint = ENV['S3_MOUNT_POINT'].to_s.strip if mountpoint.empty?
        command = ['bash', mount_script, '--unmount', minio_url]
        command << mountpoint unless mountpoint.empty?
        sh(*command)
    end
end
