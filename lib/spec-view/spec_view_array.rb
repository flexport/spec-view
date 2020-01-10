# typed: false
# TEAM: backend_infra

# A (possibly multidimensional) array which delegates to its elements by mapping
# recursively. Returned by multi: true components of SpecView when they are
# snapshotted.

require_relative "./spec_view_helpers"

# A lazy array of spec views
module SpecView
  class SpecViewArray
    extend SpecView::SpecViewHelpers
    include SpecView::SpecViewHelpers

    attr_reader :array
    attr_reader :name

    def self.delegate_and_wrap_as_list(*names)
      names.each do |name|
        define_method(name) do |*args, &block|
          raw_result = array.public_send(name, *args, &block)
          if raw_result.is_a?(Array)
            self.class.new("#{@name}.#{name}()", raw_result)
          else
            raw_result
          end
        end
      end
    end

    # Array methods
    # Methods which delegate to wrapped array
    delegate :empty?, :each, :length, :count, :reduce, to: :array
    # Methods which return a SpecViewArray
    delegate_and_wrap_as_list :map, :collect, :select, :reject, :reverse, :[], :slice

    def initialize(name, array)
      @name = name
      @array = array
    end

    # This and eql? are implemented so that tests can match against normal
    # arrays with `to eq` and `to eql`
    def ==(other)
      if other.is_a?(SpecViewArray)
        other = other.to_a
      end
      to_a == other
    end

    def eql?(other)
      self == other
    end

    # Recursively unwraps into an N-dimensional array
    def to_a
      array.map do |item|
        if item.is_a?(SpecViewArray)
          item.to_a
        else
          item
        end
      end
    end

    def to_ary
      to_a
    end

    def respond_to_missing?(name, include_private = false)
      seen_non_nil = false
      @array.compact.each do |item|
        return true if item.respond_to?(name)
        seen_non_nil = true unless item.nil?
      end
      return !seen_non_nil # if all elements are nil, we respond to anything with nil
    end

    def inspect
      # HACK: For typical exceptions, we want to show the nice component path,
      # because that's the most useful format for tracking down the culprit when
      # an element is missing or a method is mistyped. However, when rspec is
      # printing out a diff, we want to format as an array, so you can see what
      # the actual result was.
      # [Ada Cohen @ 2018-08-31 08:55:33]

      stack = Kernel.caller
      if stack.grep(%r{rspec/support/object_formatter}).present?
        to_a.inspect
      else
        "#<#{self.class.name.demodulize}:#{name}>"
      end
    end

    # TODO: Special case component methods to send array context
    def method_missing(name, *args, &block)
      return super unless respond_to_missing?(name, false)
      result = @array.map do |item|
        next nil if item.nil?
        item.public_send(name, *args, &block)
      end

      self.class.new("#{self.name}.#{name}", result)
    end
  end
end
